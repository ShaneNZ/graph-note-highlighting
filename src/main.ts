import { Plugin, debounce, type WorkspaceLeaf } from 'obsidian';
import { computeState } from './opacity';
import { GraphPatcher, type StyleOptions } from './patches';
import { DEFAULT_SETTINGS, GraphNoteHighlightingSettingTab, type GraphNoteHighlightingSettings } from './settings';
import { collectSeeds, isFileLeaf } from './tabs';
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

export default class GraphNoteHighlightingPlugin extends Plugin {
	settings: GraphNoteHighlightingSettings = { ...DEFAULT_SETTINGS };
	private patcher!: GraphPatcher;
	private style!: StyleOptions;
	private lastFileLeaf: WorkspaceLeaf | null = null;

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
		this.patcher.uninstall();
		for (const leaf of this.allGraphLeaves()) this.renderer(leaf)?.changed();
	}

	async loadSettings() {
		const data = ((await this.loadData()) ?? {}) as Record<string, unknown>;
		const migrated = migrateVisibleKeys(data);
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
		const activeRecolor = s.recolorActive ? hexToRgb(s.activeColor) : null;
		const activeRing = s.activeRing
			? { rgb: hexToRgb(s.activeRingColor), width: s.activeRingWidth, gap: s.activeRingGap }
			: null;
		this.style = {
			// Connected notes borrow the active note's colour and ring, at normal size.
			recolor: {
				active: activeRecolor,
				open: s.recolorOpen ? hexToRgb(s.openColor) : null,
				connected: activeRecolor,
			},
			size: { active: s.activeSize, open: s.openSize, connected: 1 },
			ring: {
				active: activeRing,
				open: s.openRing
					? { rgb: hexToRgb(s.openRingColor), width: s.openRingWidth, gap: s.openRingGap }
					: null,
				connected: activeRing,
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
					activeShowNames: this.settings.activeShowNames,
					openShowNames: this.settings.openShowNames,
				}),
			);
		} else {
			this.patcher.states.delete(renderer);
		}
		renderer.changed();
	}
}
