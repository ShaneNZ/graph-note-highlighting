import { App, PluginSettingTab, Setting } from 'obsidian';
import type GraphNoteHighlightingPlugin from './main';
import type { OpenScope } from './tabs';
import type { NodeRole } from './types';

export interface GraphNoteHighlightingSettings {
	applyToGlobalGraph: boolean;
	applyToLocalGraph: boolean;
	includeTags: boolean;

	highlightActive: boolean;
	recolorActive: boolean;
	activeColor: string;
	activeSize: number;
	activeRing: boolean;
	activeRingColor: string;
	activeRingWidth: number;
	activeRingGap: number;

	highlightConnected: boolean;
	connectedShowNames: boolean;
	recolorConnected: boolean;
	connectedColor: string;
	connectedSize: number;
	connectedRing: boolean;
	connectedRingColor: string;
	connectedRingWidth: number;
	connectedRingGap: number;

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
	openShowNames: boolean;

	maxHops: number;
	minConnectedBrightness: number;
	minOpacity: number;
	dimLabels: boolean;
	dimLinks: boolean;
}

export const DEFAULT_SETTINGS: GraphNoteHighlightingSettings = {
	applyToGlobalGraph: true,
	applyToLocalGraph: true,
	includeTags: true,

	highlightActive: true,
	recolorActive: false,
	activeColor: '#ffffff',
	activeSize: 1,
	activeRing: true,
	activeRingColor: '#ffffff',
	activeRingWidth: 2,
	activeRingGap: 3,

	highlightConnected: false,
	connectedShowNames: true,
	recolorConnected: false,
	connectedColor: '#ffffff',
	connectedSize: 1,
	connectedRing: true,
	connectedRingColor: '#ffffff',
	connectedRingWidth: 1,
	connectedRingGap: 2,

	recolorOpen: true,
	openColor: '#ffffff',
	openSize: 1,
	openRing: false,
	openRingColor: '#ffffff',
	openRingWidth: 1,
	openRingGap: 2,
	openWeight: 0.8,
	openScope: 'split',
	includeSidebars: true,
	openShowNames: false,

	maxHops: 3,
	minConnectedBrightness: 0.25,
	minOpacity: 0.1,
	dimLabels: true,
	dimLinks: true,
};

type Settings = GraphNoteHighlightingSettings;
type KeysOfType<T> = { [K in keyof Settings]: Settings[K] extends T ? K : never }[keyof Settings];

/** Settings keys for the per-role options, so active, connected and open notes share one builder. */
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
	connected: {
		recolor: 'recolorConnected',
		color: 'connectedColor',
		size: 'connectedSize',
		ring: 'connectedRing',
		ringColor: 'connectedRingColor',
		ringWidth: 'connectedRingWidth',
		ringGap: 'connectedRingGap',
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
} as const satisfies Record<NodeRole, Record<string, keyof Settings>>;

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

	private stepEl: HTMLElement | null = null;

	/** Show how much brightness each hop removes, and the brightness at each hop. */
	private updateStep() {
		if (!this.stepEl) return;
		const { maxHops, minConnectedBrightness: min } = this.plugin.settings;
		const step = (1 - min) / Math.max(1, maxHops);
		const levels = Array.from({ length: maxHops + 1 }, (_, h) => (1 - step * h).toFixed(2).replace(/\.?0+$/, ''));
		this.stepEl.setText(`Each hop removes ${step.toFixed(2)} brightness: ${levels.join(' → ')}.`);
	}

	private slider(
		el: HTMLElement,
		name: string,
		desc: string,
		key: KeysOfType<number>,
		min: number,
		max: number,
		step: number,
		after?: () => void,
	) {
		new Setting(el)
			.setName(name)
			.setDesc(desc)
			.addSlider((s) =>
				s
					.setLimits(min, max, step)
					.setValue(this.plugin.settings[key])
					.onChange(async (v) => {
						await this.set(key, v);
						after?.();
					}),
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

	private roleSection(el: HTMLElement, role: NodeRole, heading: string, noteDesc: string) {
		new Setting(el).setName(heading).setHeading();
		this.roleRows(el, role, noteDesc);
	}

	/** Colour, size and ring rows for one kind of highlighted note. */
	private roleRows(el: HTMLElement, role: NodeRole, noteDesc: string) {
		const k = ROLE_KEYS[role];
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

		this.toggle(el, 'Global graph', 'Apply to the global graph view.', 'applyToGlobalGraph');
		this.toggle(el, 'Local graph', 'Apply to local graph views.', 'applyToLocalGraph');
		this.toggle(
			el,
			'Include tags',
			'When the graph shows tags, light up tags on the active and open notes, and the notes that share them. Off leaves tags faded.',
			'includeTags',
		);

		new Setting(el).setName('Active note').setHeading();
		new Setting(el)
			.setName('Highlight active note')
			.setDesc(
				'Style the note you are editing and light up the notes around it. Off treats it like any other open note, and connected notes are not highlighted.',
			)
			.addToggle((t) =>
				// Redraw so the active-note settings below follow the toggle.
				t.setValue(this.plugin.settings.highlightActive).onChange(async (v) => this.set('highlightActive', v, true)),
			);
		if (this.plugin.settings.highlightActive) {
			this.roleRows(el, 'active', 'the note you are editing');
		}

		new Setting(el).setName('Connected notes').setHeading();
		new Setting(el)
			.setName('Highlight connected notes')
			.setDesc("Style the notes linked to the active note, and draw their links in the active note's ring colour.")
			.addToggle((t) =>
				// Redraw so the connected-note settings below follow the toggle.
				t
					.setValue(this.plugin.settings.highlightConnected)
					.onChange(async (v) => this.set('highlightConnected', v, true)),
			);
		if (this.plugin.settings.highlightConnected) {
			this.roleRows(el, 'connected', 'notes linked to the active note');
			this.toggle(
				el,
				'Always display node names',
				'Show the names of notes linked to the active note at every zoom level.',
				'connectedShowNames',
			);
		}

		this.roleSection(el, 'open', 'Open notes', 'open notes');
		new Setting(el)
			.setName('Count as open')
			.setDesc('Which other notes count as open. Notes showing in other panes always count.')
			.addDropdown((d) =>
				d
					.addOptions({
						split: 'Tabs in the active split',
						all: 'All tabs',
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
			'Count notes in the sidebars as open notes. With tabs in the active split, the sidebar must be expanded.',
			'includeSidebars',
		);
		this.toggle(el, 'Always display node names', 'Show the names of open notes at every zoom level.', 'openShowNames');

		new Setting(el).setName('Fading').setHeading();
		this.slider(
			el,
			'Maximum hops',
			'How many links away from an open note are lit up. Notes further away drop to the minimum opacity.',
			'maxHops',
			1,
			10,
			1,
			() => this.updateStep(),
		);
		this.slider(
			el,
			'Minimum brightness for connected notes',
			'Brightness of notes at the last lit hop. Brightness falls in even steps from the open note down to this.',
			'minConnectedBrightness',
			0,
			1,
			0.05,
			() => this.updateStep(),
		);
		this.stepEl = new Setting(el).setName('Step per hop').descEl;
		this.updateStep();
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
