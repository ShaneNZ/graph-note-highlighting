import { nodeOpacity } from './opacity';
import type { GraphLink, GraphNode, GraphRenderer, GraphState, PixiGraphics, TabRole } from './types';

export interface StyleOptions {
	recolor: Record<TabRole, number | null>; // rgb, or null to keep the group colour
	size: Record<TabRole, number>;
	ring: Record<TabRole, RingStyle | null>; // null for no ring
	dimLabels: boolean;
	dimLinks: boolean;
}

export interface RingStyle {
	rgb: number;
	/** Line thickness in screen pixels at normal zoom. */
	width: number;
	/** Space between the node and the ring, in screen pixels at normal zoom. */
	gap: number;
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
	private rings = new Map<GraphNode, PixiGraphics>();

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
		for (const node of [...this.rings.keys()]) this.removeRing(node);
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
			updateRing: (n: GraphNode, st: GraphState | undefined) => this.updateRing(n, st),
			removeRing: (n: GraphNode) => this.removeRing(n),
			pruneRings: () => this.pruneRings(),
		};
	}

	/**
	 * Draw (or remove) the ring around an open note. Drawn the same way Obsidian draws
	 * its hover ring: a PIXI.Graphics on the renderer's hanger, scaled with the nodes.
	 */
	private updateRing(node: GraphNode, state: GraphState | undefined): void {
		const role = state?.roles.get(node.id);
		const style = role ? this.getStyle().ring[role] : null;
		if (!style || !node.circle) {
			this.removeRing(node);
			return;
		}

		let ring = this.rings.get(node);
		if (!ring) {
			const PIXI = (window as unknown as { PIXI?: { Graphics: new () => PixiGraphics } }).PIXI;
			if (!PIXI) return;
			ring = new PIXI.Graphics();
			ring.eventMode = 'none';
			ring.zIndex = 1;
			node.renderer.hanger.addChild(ring);
			this.rings.set(node, ring);
		}

		const r = node.renderer;
		ring.visible = node.circle.visible;
		if (!ring.visible) return;
		// One screen pixel in node-local units, never thinner than Obsidian's own ring.
		const px = Math.max(1, 1 / r.scale / r.nodeScale);
		const width = style.width * px;
		ring.x = node.x;
		ring.y = node.y;
		ring.scale.x = ring.scale.y = r.nodeScale;
		ring.alpha = node.fadeAlpha ?? 1;
		ring.clear();
		ring.lineStyle(width, style.rgb, 1);
		ring.drawCircle(0, 0, node.getSize() + style.gap * px + width / 2);
	}

	/** Remove rings left on node objects the graph has replaced (it rebuilds nodes on new data). */
	pruneRings(): void {
		for (const node of [...this.rings.keys()]) {
			if (node.renderer.nodeLookup[node.id] !== node) this.removeRing(node);
		}
	}

	private removeRing(node: GraphNode): void {
		const ring = this.rings.get(node);
		if (!ring) return;
		ring.parent?.removeChild(ring);
		ring.destroy();
		this.rings.delete(node);
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
					self.pruneRings();
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
				self.updateRing(this, state);
				return result;
			},
		);

		this.around(proto, 'clearGraphics', (orig) =>
			function (this: GraphNode, ...args: unknown[]) {
				self.removeRing(this);
				return orig.apply(this, args);
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
