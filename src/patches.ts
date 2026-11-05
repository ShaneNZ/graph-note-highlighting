import { nodeOpacity } from './opacity';
import type { GraphLink, GraphNode, GraphRenderer, GraphState, TabRole } from './types';

export interface StyleOptions {
	recolor: Record<TabRole, number | null>; // rgb, or null to keep the group colour
	size: Record<TabRole, number>;
	dimLabels: boolean;
	dimLinks: boolean;
}

type AnyFn = (...args: unknown[]) => unknown;

/**
 * Patches the prototypes of Obsidian's graph node, link and renderer classes.
 * One patch covers every graph (global and local) and every node created later,
 * and Obsidian's own colour easing and hover fading keep working on top.
 */
export class GraphPatcher {
	readonly states = new WeakMap<GraphRenderer, GraphState>();
	private restores: (() => void)[] = [];
	private patchedProtos = new Set<object>();
	private linkBase = new WeakMap<GraphLink, { line: number; arrow: number }>();

	constructor(
		private getStyle: () => StyleOptions,
		private onData: (renderer: GraphRenderer) => void,
	) {}

	/** Patch whatever prototypes this renderer exposes. Safe to call repeatedly. */
	ensurePatched(renderer: GraphRenderer): void {
		this.patchRenderer(Object.getPrototypeOf(renderer) as object);
		const node = renderer.nodes[0];
		if (node) this.patchNode(Object.getPrototypeOf(node) as object);
		const link = renderer.links[0];
		if (link) this.patchLink(Object.getPrototypeOf(link) as object);
	}

	uninstall(): void {
		for (const restore of this.restores.reverse()) restore();
		this.restores = [];
		this.patchedProtos.clear();
	}

	/** Closures for the patched methods, which run with `this` bound to a node, link or renderer. */
	private handle() {
		return {
			states: this.states,
			linkBase: this.linkBase,
			getStyle: () => this.getStyle(),
			ensurePatched: (r: GraphRenderer) => this.ensurePatched(r),
			onData: (r: GraphRenderer) => this.onData(r),
		};
	}

	private around(proto: object, name: string, wrap: (orig: AnyFn) => AnyFn): void {
		const target = proto as Record<string, AnyFn>;
		const orig = target[name];
		if (typeof orig !== 'function') return;
		const wrapped = wrap(orig);
		target[name] = wrapped;
		this.restores.push(() => {
			if (target[name] === wrapped) target[name] = orig;
		});
	}

	private once(proto: object): boolean {
		if (this.patchedProtos.has(proto)) return false;
		this.patchedProtos.add(proto);
		return true;
	}

	private patchRenderer(proto: object): void {
		if (!this.once(proto)) return;
		const self = this.handle();
		this.around(proto, 'setData', (orig) =>
			function (this: GraphRenderer, ...args: unknown[]) {
				const result = orig.apply(this, args);
				try {
					self.ensurePatched(this);
					self.onData(this);
				} catch (e) {
					console.error('Graph Note Highlighting: failed to restyle graph', e);
				}
				return result;
			},
		);
	}

	private patchNode(proto: object): void {
		if (!this.once(proto)) return;
		const self = this.handle();

		this.around(proto, 'getFillColor', (orig) =>
			function (this: GraphNode, ...args: unknown[]) {
				const color = orig.apply(this, args) as GraphNode['getFillColor'] extends () => infer C ? C : never;
				const state = self.states.get(this.renderer);
				if (!state) return color;
				const role = state.roles.get(this.id);
				const rgb = (role && self.getStyle().recolor[role]) ?? color.rgb;
				return { rgb, a: color.a * nodeOpacity(state, this.id) };
			},
		);

		this.around(proto, 'getSize', (orig) =>
			function (this: GraphNode, ...args: unknown[]) {
				const size = orig.apply(this, args) as number;
				const role = self.states.get(this.renderer)?.roles.get(this.id);
				return role ? size * self.getStyle().size[role] : size;
			},
		);

		this.around(proto, 'render', (orig) =>
			function (this: GraphNode, ...args: unknown[]) {
				const result = orig.apply(this, args);
				const state = self.states.get(this.renderer);
				if (state && this.text && self.getStyle().dimLabels) {
					this.text.alpha *= nodeOpacity(state, this.id);
				}
				return result;
			},
		);
	}

	private patchLink(proto: object): void {
		if (!this.once(proto)) return;
		const self = this.handle();

		this.around(proto, 'render', (orig) =>
			function (this: GraphLink, ...args: unknown[]) {
				// Obsidian eases line alpha from its previous value each frame, so hand it back
				// the undimmed value before rendering, then dim the result.
				const base = self.linkBase.get(this);
				if (base) {
					if (this.line) this.line.alpha = base.line;
					if (this.arrow) this.arrow.alpha = base.arrow;
					self.linkBase.delete(this);
				}
				const result = orig.apply(this, args);

				const state = self.states.get(this.renderer);
				if (state && self.getStyle().dimLinks && this.line) {
					self.linkBase.set(this, { line: this.line.alpha, arrow: this.arrow?.alpha ?? 0 });
					const factor = Math.min(nodeOpacity(state, this.source.id), nodeOpacity(state, this.target.id));
					this.line.alpha *= factor;
					if (this.arrow) this.arrow.alpha *= factor;
				}
				return result;
			},
		);
	}
}
