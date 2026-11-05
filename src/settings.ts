import { App, PluginSettingTab, Setting } from 'obsidian';
import type GraphNoteHighlightingPlugin from './main';
import type { TabRole } from './types';

export interface GraphNoteHighlightingSettings {
	enabled: boolean;
	applyToGlobalGraph: boolean;
	applyToLocalGraph: boolean;

	recolorActive: boolean;
	activeColor: string;
	activeSize: number;
	activeRing: boolean;
	activeRingColor: string;
	activeRingWidth: number;
	activeRingGap: number;

	recolorVisible: boolean;
	visibleColor: string;
	visibleSize: number;
	visibleRing: boolean;
	visibleRingColor: string;
	visibleRingWidth: number;
	visibleRingGap: number;
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
	activeRing: true,
	activeRingColor: '#ffffff',
	activeRingWidth: 2,
	activeRingGap: 2,

	recolorVisible: true,
	visibleColor: '#ff9f0a',
	visibleSize: 1.3,
	visibleRing: true,
	visibleRingColor: '#ff9f0a',
	visibleRingWidth: 1,
	visibleRingGap: 2,
	visibleWeight: 0.7,
	includeSidebars: true,

	fadePerHop: 0.5,
	minOpacity: 0.1,
	dimLabels: true,
	dimLinks: true,
};

type Settings = GraphNoteHighlightingSettings;
type KeysOfType<T> = { [K in keyof Settings]: Settings[K] extends T ? K : never }[keyof Settings];

/** Settings keys for the per-role options, so active and visible share one builder. */
const ROLE_KEYS = {
	active: {
		recolor: 'recolorActive',
		color: 'activeColor',
		size: 'activeSize',
		ring: 'activeRing',
		ringColor: 'activeRingColor',
		ringWidth: 'activeRingWidth',
		ringGap: 'activeRingGap',
	},
	visible: {
		recolor: 'recolorVisible',
		color: 'visibleColor',
		size: 'visibleSize',
		ring: 'visibleRing',
		ringColor: 'visibleRingColor',
		ringWidth: 'visibleRingWidth',
		ringGap: 'visibleRingGap',
	},
} as const satisfies Record<TabRole, Record<string, keyof Settings>>;

export class GraphNoteHighlightingSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: GraphNoteHighlightingPlugin,
	) {
		super(app, plugin);
	}

	private async set<K extends keyof Settings>(key: K, value: Settings[K], redraw = false) {
		this.plugin.settings[key] = value;
		await this.plugin.saveSettings();
		if (redraw) this.display();
	}

	private slider(
		el: HTMLElement,
		name: string,
		desc: string,
		key: KeysOfType<number>,
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

	private toggle(el: HTMLElement, name: string, desc: string, key: KeysOfType<boolean>) {
		new Setting(el)
			.setName(name)
			.setDesc(desc)
			.addToggle((t) => t.setValue(this.plugin.settings[key]).onChange(async (v) => this.set(key, v)));
	}

	/** A toggle with a colour picker beside it; the picker is disabled while the toggle is off. */
	private toggledColor(
		el: HTMLElement,
		name: string,
		desc: string,
		toggleKey: KeysOfType<boolean>,
		colorKey: KeysOfType<string>,
	) {
		const s = this.plugin.settings;
		new Setting(el)
			.setName(name)
			.setDesc(desc)
			.addColorPicker((c) =>
				c
					.setValue(s[colorKey])
					.setDisabled(!s[toggleKey])
					.onChange(async (v) => this.set(colorKey, v)),
			)
			.addToggle((t) =>
				// Redraw so the colour picker (and any ring sliders) follow the toggle.
				t.setValue(s[toggleKey]).onChange(async (v) => this.set(toggleKey, v, true)),
			);
	}

	private roleSection(el: HTMLElement, role: TabRole, heading: string, noteDesc: string) {
		const k = ROLE_KEYS[role];
		new Setting(el).setName(heading).setHeading();
		this.toggledColor(
			el,
			'Colour',
			`Recolour ${noteDesc}. Off keeps its colour group colour.`,
			k.recolor,
			k.color,
		);
		this.slider(el, 'Size', 'Node size multiplier.', k.size, 1, 3, 0.1);
		this.toggledColor(el, 'Ring', `Draw a ring around ${noteDesc}.`, k.ring, k.ringColor);
		if (this.plugin.settings[k.ring]) {
			this.slider(el, 'Ring width', 'Thickness of the ring, in pixels.', k.ringWidth, 0.5, 8, 0.5);
			this.slider(el, 'Ring gap', 'Space between the note and its ring, in pixels.', k.ringGap, 0, 10, 0.5);
		}
	}

	display(): void {
		const el = this.containerEl;
		el.empty();

		this.toggle(el, 'Enabled', 'Turn graph highlighting on or off.', 'enabled');
		this.toggle(el, 'Global graph', 'Apply to the global graph view.', 'applyToGlobalGraph');
		this.toggle(el, 'Local graph', 'Apply to local graph views.', 'applyToLocalGraph');

		this.roleSection(el, 'active', 'Active note', 'the note you are editing');

		this.roleSection(el, 'visible', 'Visible notes', 'notes showing in other panes');
		this.slider(
			el,
			'Reach',
			'How strongly a visible note lights up its neighbours, relative to the active note.',
			'visibleWeight',
			0,
			1,
			0.05,
		);
		this.toggle(
			el,
			'Include sidebars',
			'Count notes open in an expanded sidebar as visible notes.',
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
			'Opacity of notes no open note reaches. Keeps them faintly visible.',
			'minOpacity',
			0,
			1,
			0.05,
		);
		this.toggle(el, 'Fade labels', 'Fade note titles along with their nodes.', 'dimLabels');
		this.toggle(el, 'Fade links', 'Fade links to match the fainter of their two notes.', 'dimLinks');
	}
}
