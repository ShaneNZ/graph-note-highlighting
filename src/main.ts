import { Plugin, debounce, type WorkspaceLeaf } from 'obsidian';
import { computeState } from './opacity';
import { GraphPatcher, type StyleOptions } from './patches';
import { DEFAULT_SETTINGS, GraphNoteHighlightingSettingTab, type GraphNoteHighlightingSettings } from './settings';
import { collectSeeds, isFileLeaf } from './tabs';
import type { GraphRenderer } from './types';

function hexToRgb(hex: string): number {
	return parseInt(hex.replace('#', ''), 16);
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
		this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<GraphNoteHighlightingSettings>) };
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
				visible: s.recolorVisible ? hexToRgb(s.visibleColor) : null,
			},
			size: { active: s.activeSize, visible: s.visibleSize },
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
					{ visibleWeight: this.settings.visibleWeight, includeSidebars: this.settings.includeSidebars },
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
				}),
			);
		} else {
			this.patcher.states.delete(renderer);
		}
		renderer.changed();
	}
}
