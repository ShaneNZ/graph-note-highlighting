import { App, PluginSettingTab, Setting } from 'obsidian';
import type GraphNoteHighlightingPlugin from './main';

export interface GraphNoteHighlightingSettings {
	enabled: boolean;
	applyToGlobalGraph: boolean;
	applyToLocalGraph: boolean;

	recolorActive: boolean;
	activeColor: string;
	activeSize: number;

	recolorVisible: boolean;
	visibleColor: string;
	visibleSize: number;
	visibleWeight: number;
	includeSidebars: boolean;

	fadePerHop: number;
	minOpacity: number;
	dimLabels: boolean;
	dimLinks: boolean;
}

export const DEFAULT_SETTINGS: GraphNoteHighlightingSettings = {
	enabled: true,
	applyToGlobalGraph: true,
	applyToLocalGraph: true,

	recolorActive: true,
	activeColor: '#ff3b30',
	activeSize: 1.6,

	recolorVisible: true,
	visibleColor: '#ff9f0a',
	visibleSize: 1.3,
	visibleWeight: 0.7,
	includeSidebars: true,

	fadePerHop: 0.5,
	minOpacity: 0.1,
	dimLabels: true,
	dimLinks: true,
};

export class GraphNoteHighlightingSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: GraphNoteHighlightingPlugin,
	) {
		super(app, plugin);
	}

	private async set<K extends keyof GraphNoteHighlightingSettings>(key: K, value: GraphNoteHighlightingSettings[K]) {
		this.plugin.settings[key] = value;
		await this.plugin.saveSettings();
	}

	private slider(
		el: HTMLElement,
		name: string,
		desc: string,
		key: 'activeSize' | 'visibleSize' | 'visibleWeight' | 'fadePerHop' | 'minOpacity',
		min: number,
		max: number,
		step: number,
	) {
		new Setting(el)
			.setName(name)
			.setDesc(desc)
			.addSlider((s) =>
				s
					.setLimits(min, max, step)
					.setValue(this.plugin.settings[key])
					.onChange(async (v) => this.set(key, v)),
			);
	}

	private toggle(
		el: HTMLElement,
		name: string,
		desc: string,
		key:
			| 'enabled'
			| 'applyToGlobalGraph'
			| 'applyToLocalGraph'
			| 'recolorActive'
			| 'recolorVisible'
			| 'includeSidebars'
			| 'dimLabels'
			| 'dimLinks',
	) {
		new Setting(el)
			.setName(name)
			.setDesc(desc)
			.addToggle((t) => t.setValue(this.plugin.settings[key]).onChange(async (v) => this.set(key, v)));
	}

	private color(el: HTMLElement, name: string, key: 'activeColor' | 'visibleColor') {
		new Setting(el)
			.setName(name)
			.addColorPicker((c) => c.setValue(this.plugin.settings[key]).onChange(async (v) => this.set(key, v)));
	}

	display(): void {
		const el = this.containerEl;
		el.empty();

		this.toggle(el, 'Enabled', 'Turn graph highlighting on or off.', 'enabled');
		this.toggle(el, 'Global graph', 'Apply to the global graph view.', 'applyToGlobalGraph');
		this.toggle(el, 'Local graph', 'Apply to local graph views.', 'applyToLocalGraph');

		new Setting(el).setName('Active tab').setHeading();
		this.toggle(el, 'Recolour', 'Replace the colour group colour of the note you are editing.', 'recolorActive');
		this.color(el, 'Colour', 'activeColor');
		this.slider(el, 'Size', 'Node size multiplier.', 'activeSize', 1, 3, 0.1);

		new Setting(el).setName('Visible tabs').setHeading();
		this.toggle(
			el,
			'Recolour',
			'Replace the colour group colour of notes showing in other panes.',
			'recolorVisible',
		);
		this.color(el, 'Colour', 'visibleColor');
		this.slider(el, 'Size', 'Node size multiplier.', 'visibleSize', 1, 3, 0.1);
		this.slider(
			el,
			'Reach',
			'How strongly a visible tab lights up its neighbours, relative to the active tab.',
			'visibleWeight',
			0,
			1,
			0.05,
		);
		this.toggle(
			el,
			'Include sidebars',
			'Count notes open in an expanded sidebar as visible tabs.',
			'includeSidebars',
		);

		new Setting(el).setName('Fading').setHeading();
		this.slider(
			el,
			'Brightness kept per hop',
			'Each link away from an open note multiplies its brightness by this.',
			'fadePerHop',
			0,
			0.9,
			0.05,
		);
		this.slider(
			el,
			'Minimum opacity',
			'Opacity of notes no open tab reaches. Keeps them faintly visible.',
			'minOpacity',
			0,
			1,
			0.05,
		);
		this.toggle(el, 'Fade labels', 'Fade note titles along with their nodes.', 'dimLabels');
		this.toggle(el, 'Fade links', 'Fade links to match the fainter of their two notes.', 'dimLinks');
	}
}
