import { App, PluginSettingTab, Setting } from 'obsidian';
import type GraphNoteHighlightingPlugin from './main';
import type { OpenScope } from './tabs';
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
	highlightConnected: boolean;

	recolorOpen: boolean;
	openColor: string;
	openSize: number;
	openRing: boolean;
	openRingColor: string;
	openRingWidth: number;
	openRingGap: number;
	openWeight: number;
	openScope: OpenScope;
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

	recolorActive: false,
	activeColor: '#ffffff',
	activeSize: 1,
	activeRing: true,
	activeRingColor: '#ffffff',
	activeRingWidth: 2,
	activeRingGap: 3,
	highlightConnected: false,

	recolorOpen: true,
	openColor: '#ffffff',
	openSize: 1,
	openRing: false,
	openRingColor: '#ffffff',
	openRingWidth: 1,
	openRingGap: 2,
	openWeight: 0.8,
	openScope: 'onscreen',
	includeSidebars: true,

	fadePerHop: 0.5,
	minOpacity: 0.1,
	dimLabels: true,
	dimLinks: true,
};

type Settings = GraphNoteHighlightingSettings;
type KeysOfType<T> = { [K in keyof Settings]: Settings[K] extends T ? K : never }[keyof Settings];

/** Settings keys for the per-role options, so active and open share one builder. */
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
	open: {
		recolor: 'recolorOpen',
		color: 'openColor',
		size: 'openSize',
		ring: 'openRing',
		ringColor: 'openRingColor',
		ringWidth: 'openRingWidth',
		ringGap: 'openRingGap',
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
			`Recolour ${noteDesc}. Off keeps the colour group colour.`,
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
		this.toggle(
			el,
			'Highlight connected notes',
			"Give notes linked to the active note the active note's colour and ring, and draw their links in the ring colour.",
			'highlightConnected',
		);

		this.roleSection(el, 'open', 'Open notes', 'open notes');
		new Setting(el)
			.setName('Count as open')
			.setDesc('Which other notes count as open. Notes showing in other panes always count.')
			.addDropdown((d) =>
				d
					.addOptions({
						onscreen: 'Notes on screen only',
						split: 'Plus background tabs in the active split',
						all: 'Plus all background tabs',
					})
					.setValue(this.plugin.settings.openScope)
					.onChange(async (v) => this.set('openScope', v as OpenScope)),
			);
		this.slider(
			el,
			'Reach',
			'How strongly an open note lights up its neighbours, relative to the active note.',
			'openWeight',
			0,
			1,
			0.05,
		);
		this.toggle(
			el,
			'Include sidebars',
			'Count notes in the sidebars as open notes. With notes on screen only, the sidebar must be expanded.',
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
