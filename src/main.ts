import { Keymap, Plugin, debounce, type WorkspaceLeaf } from 'obsidian';
import { computeState } from './opacity';
import { GraphPatcher, type StyleOptions } from './patches';
import { DEFAULT_SETTINGS, GraphNoteHighlightingSettingTab, type GraphNoteHighlightingSettings } from './settings';
import { collectSeeds, findOpenLeaf, isFileLeaf } from './tabs';
import type { GraphRenderer } from './types';

function hexToRgb(hex: string): number {
	return parseInt(hex.replace('#', ''), 16);
}

/**
 * Settings saved before 0.2.0 called open notes "visible" notes
 * (recolorVisible, visibleColor, …). Move those values to the new keys.
 * Returns true if anything changed.
 */
function migrateVisibleKeys(data: Record<string, unknown>): boolean {
	let changed = false;
	for (const oldKey of Object.keys(data)) {
		const newKey =
			oldKey === 'recolorVisible' ? 'recolorOpen' : oldKey.startsWith('visible') ? 'open' + oldKey.slice(7) : null;
		if (!newKey) continue;
		if (!(newKey in data)) data[newKey] = data[oldKey];
		delete data[oldKey];
		changed = true;
	}
	return changed;
}

/**
 * Before 0.5.0, connected notes borrowed the active note's colour and ring, and
 * their names setting was called activeShowNames. Give them their own settings,
 * starting from what they looked like before. Returns true if anything changed.
 */
function migrateConnectedKeys(data: Record<string, unknown>): boolean {
	let changed = false;
	if ('activeShowNames' in data) {
		if (!('connectedShowNames' in data)) data.connectedShowNames = data.activeShowNames;
		delete data.activeShowNames;
		changed = true;
	}
	if ('highlightConnected' in data && !('connectedRing' in data)) {
		const copy: [string, string][] = [
			['recolorActive', 'recolorConnected'],
			['activeColor', 'connectedColor'],
			['activeRing', 'connectedRing'],
			['activeRingColor', 'connectedRingColor'],
			['activeRingWidth', 'connectedRingWidth'],
			['activeRingGap', 'connectedRingGap'],
		];
		for (const [from, to] of copy) if (from in data) data[to] = data[from];
		changed = true;
	}
	return changed;
}

export default class GraphNoteHighlightingPlugin extends Plugin {
	settings: GraphNoteHighlightingSettings = { ...DEFAULT_SETTINGS };
	private patcher!: GraphPatcher;
	private style!: StyleOptions;
	private lastFileLeaf: WorkspaceLeaf | null = null;
	private clickRestores = new Map<GraphRenderer, () => void>();

	async onload() {
		await this.loadSettings();
		this.patcher = new GraphPatcher(
			() => this.style,
			(renderer) => this.restyle(renderer),
		);
		this.addSettingTab(new GraphNoteHighlightingSettingTab(this.app, this));

		this.addCommand({
			id: 'toggle',
			name: 'Toggle graph highlighting',
			callback: async () => {
				this.settings.enabled = !this.settings.enabled;
				await this.saveSettings();
			},
		});

		const ws = this.app.workspace;
		this.registerEvent(
			ws.on('active-leaf-change', (leaf) => {
				if (isFileLeaf(leaf)) this.lastFileLeaf = leaf;
				this.refreshSoon();
			}),
		);
		this.registerEvent(ws.on('layout-change', this.refreshSoon));
		this.registerEvent(ws.on('file-open', this.refreshSoon));
		this.registerEvent(ws.on('resize', this.refreshSoon));
		ws.onLayoutReady(() => {
			const recent = ws.getMostRecentLeaf();
			if (isFileLeaf(recent)) this.lastFileLeaf = recent;
			this.refresh();
		});
	}

	onunload() {
		for (const restore of this.clickRestores.values()) restore();
		this.clickRestores.clear();
		this.patcher.uninstall();
		for (const leaf of this.allGraphLeaves()) this.renderer(leaf)?.changed();
	}

	async loadSettings() {
		const data = ((await this.loadData()) ?? {}) as Record<string, unknown>;
		let migrated = migrateVisibleKeys(data);
		// 0.3.0 and earlier had an "on screen only" scope, now folded into "Tabs in the active split".
		if (data.openScope === 'onscreen') {
			data.openScope = 'split';
			migrated = true;
		}
		if (migrateConnectedKeys(data)) migrated = true;
		this.settings = { ...DEFAULT_SETTINGS, ...(data as Partial<GraphNoteHighlightingSettings>) };
		if (migrated) await this.saveData(this.settings);
		this.updateStyle();
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.updateStyle();
		this.refresh();
	}

	private updateStyle() {
		const s = this.settings;
		this.style = {
			recolor: {
				active: s.recolorActive ? hexToRgb(s.activeColor) : null,
				open: s.recolorOpen ? hexToRgb(s.openColor) : null,
				connected: s.recolorConnected ? hexToRgb(s.connectedColor) : null,
			},
			size: { active: s.activeSize, open: s.openSize, connected: s.connectedSize },
			ring: {
				active: s.activeRing
					? { rgb: hexToRgb(s.activeRingColor), width: s.activeRingWidth, gap: s.activeRingGap }
					: null,
				open: s.openRing
					? { rgb: hexToRgb(s.openRingColor), width: s.openRingWidth, gap: s.openRingGap }
					: null,
				connected: s.connectedRing
					? { rgb: hexToRgb(s.connectedRingColor), width: s.connectedRingWidth, gap: s.connectedRingGap }
					: null,
			},
			connectedLink: hexToRgb(s.activeRingColor),
			dimLabels: s.dimLabels,
			dimLinks: s.dimLinks,
		};
	}

	private refreshSoon = debounce(() => this.refresh(), 50, true);

	private allGraphLeaves(): WorkspaceLeaf[] {
		const ws = this.app.workspace;
		return [...ws.getLeavesOfType('graph'), ...ws.getLeavesOfType('localgraph')];
	}

	private renderer(leaf: WorkspaceLeaf): GraphRenderer | null {
		return (leaf.view as unknown as { renderer?: GraphRenderer }).renderer ?? null;
	}

	private applies(renderer: GraphRenderer): boolean {
		if (!this.settings.enabled) return false;
		for (const leaf of this.allGraphLeaves()) {
			if (this.renderer(leaf) !== renderer) continue;
			const type = leaf.view.getViewType();
			return type === 'graph' ? this.settings.applyToGlobalGraph : this.settings.applyToLocalGraph;
		}
		return false;
	}

	/** Recompute every open graph. */
	refresh() {
		this.patcher.pruneRings();
		for (const leaf of this.allGraphLeaves()) {
			const renderer = this.renderer(leaf);
			if (!renderer) continue;
			this.patcher.ensurePatched(renderer);
			this.patchClicks(renderer);
			this.restyle(renderer);
		}
	}

	/** Recompute one graph from the current tab layout, then ask Obsidian to redraw it. */
	private restyle(renderer: GraphRenderer) {
		const seeds = this.applies(renderer)
			? collectSeeds(
					this.app,
					{
						openWeight: this.settings.openWeight,
						activeIncludeTags: this.settings.activeIncludeTags,
						openIncludeTags: this.settings.openIncludeTags,
						includeSidebars: this.settings.includeSidebars,
						scope: this.settings.openScope,
					},
					this.lastFileLeaf,
				)
			: [];
		// With no open notes there is nothing to highlight, so leave the graph as Obsidian draws it.
		if (seeds.length > 0) {
			this.patcher.states.set(
				renderer,
				computeState(renderer, seeds, {
					fadePerHop: this.settings.fadePerHop,
					minOpacity: this.settings.minOpacity,
					highlightConnected: this.settings.highlightConnected,
					connectedShowNames: this.settings.connectedShowNames,
					openShowNames: this.settings.openShowNames,
				}),
			);
		} else {
			this.patcher.states.delete(renderer);
		}
		renderer.changed();
	}

	/**
	 * Clicking a note that is already open in a tab switches to that tab instead of
	 * opening it again. Modifier clicks and tags keep Obsidian's behaviour. The click
	 * handler is a bound copy on each renderer, so it is wrapped per renderer.
	 */
	private patchClicks(renderer: GraphRenderer) {
		if (this.clickRestores.has(renderer)) return;
		const target = renderer as unknown as { onNodeClick?: (evt: MouseEvent, id: string, type: string) => void };
		const orig = target.onNodeClick;
		if (typeof orig !== 'function') return;
		const wrapped = (evt: MouseEvent, id: string, type: string) => {
			if (this.settings.enabled && type !== 'tag' && !Keymap.isModEvent(evt)) {
				const leaf = findOpenLeaf(this.app, id);
				if (leaf) {
					void this.app.workspace.revealLeaf(leaf).then(() => {
						this.app.workspace.setActiveLeaf(leaf, { focus: true });
					});
					return;
				}
			}
			orig(evt, id, type);
		};
		target.onNodeClick = wrapped;
		this.clickRestores.set(renderer, () => {
			if (target.onNodeClick === wrapped) target.onNodeClick = orig;
		});
	}
}
