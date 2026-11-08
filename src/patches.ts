import { nodeOpacity } from './opacity';
import type {
	GraphLink,
	GraphNode,
	GraphRenderer,
	GraphState,
	NodeRole,
	PixiContainer,
	PixiGraphics,
	PixiSprite,
} from './types';

export interface StyleOptions {
	recolor: Record<NodeRole, number | null>; // rgb, or null to keep the group colour
	size: Record<NodeRole, number>;
	ring: Record<NodeRole, RingStyle | null>; // null for no ring
	dimLabels: boolean;
	dimLinks: boolean;
}

export interface RingStyle {
	/** Ring colour, or null to match the note's dot colour. */
	rgb: number | null;
	/** Line thickness in screen pixels at normal zoom. */
	width: number;
	/** Space between the node and the ring, in screen pixels at normal zoom. */
	gap: number;
}

type AnyFn = (...args: unknown[]) => unknown;

/**
 * Make a link run between ring edges instead of dot edges. Obsidian has already
 * placed the line from the edge of one dot to the edge of the other; move whichever
 * end has a ring (null radius = leave that end on the dot).
 */
function trimToRings(link: GraphLink, sourceRadius: number | null, targetRadius: number | null): void {
	if (sourceRadius === null && targetRadius === null) return;
	const { source, target, line, arrow, px } = link;
	const dx = target.x - source.x;
	const dy = target.y - source.y;
	const length = Math.sqrt(dx * dx + dy * dy);
	if (!length) return;
	const scale = link.renderer.nodeScale;
	const from = sourceRadius ?? source.getSize() * scale;
	const to = targetRadius ?? target.getSize() * scale;
	if (line?.visible && px) {
		px.x = source.x + (dx * from) / length;
		px.y = source.y + (dy * from) / length;
		line.width = Math.max(0, length - from - to);
	}
	if (arrow?.visible && targetRadius !== null) {
		arrow.x = target.x - (dx * (to + 1)) / length;
		arrow.y = target.y - (dy * (to + 1)) / length;
	}
}

/**
 * Show a node's name whatever the zoom level. Obsidian hides names when zoomed out;
 * this places the label the way Obsidian places a hovered node's label, at a
 * readable size, still fading with the node when another note is hovered.
 */
function showLabel(node: GraphNode): void {
	const text = node.text;
	if (!text || !node.circle?.visible) return;
	const r = node.renderer;
	const f = r.nodeScale;
	text.visible = true;
	text.x = node.x;
	text.y = node.y + (node.getSize() + 5) * f + (node.moveText ?? 0) / r.scale;
	text.scale.x = text.scale.y = r.scale < 1 ? 1 / r.scale : f;
	text.alpha = (node.fadeAlpha ?? 1) * r.colors.text.a;
}

/**
 * Patches the prototypes of Obsidian's graph node, link and renderer classes.
 * One patch covers every graph (global and local) and every node created later,
 * and Obsidian's own colour easing and hover fading keep working on top.
 */
export class GraphPatcher {
	readonly states = new WeakMap<GraphRenderer, GraphState>();
	private restores: (() => void)[] = [];
	private patchedProtos = new Set<object>();
	private linkBase = new WeakMap<GraphLink, { line: number; arrow: number; tint?: number }>();
	private rings = new Map<GraphNode, PixiGraphics>();
	private raised = new WeakSet<GraphLink>();
	private overlays = new Map<GraphRenderer, PixiContainer>();
	private blends = new Map<GraphLink, PixiSprite>();
	private gradient: unknown = null;

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
		for (const link of [...this.blends.keys()]) this.removeBlend(link);
		(this.gradient as { destroy?(all: boolean): void } | null)?.destroy?.(true);
		this.gradient = null;
		// Hand any raised links back to the graph's own layer, under the nodes.
		for (const [renderer, overlay] of this.overlays) {
			for (const child of [...overlay.children]) {
				overlay.removeChild(child);
				renderer.hanger.addChildAt(child, 0);
			}
			overlay.parent?.removeChild(overlay);
			overlay.destroy();
		}
		this.overlays.clear();
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
			linkRadius: (n: GraphNode, st: GraphState | undefined) => this.linkRadius(n, st),
			setRaised: (l: GraphLink, on: boolean) => this.setRaised(l, on),
			endColour: (n: GraphNode, st: GraphState) => this.endColour(n, st),
			updateBlend: (l: GraphLink, rgb: number | null) => this.updateBlend(l, rgb),
		};
	}

	/**
	 * A container drawn above everything else in a graph, for highlighted links and rings.
	 * Obsidian sorts the graph's layer by zIndex (lines 0, dots and arrows 1, names 2),
	 * so the overlay sits at 3. It is also moved back to the end whenever something lands
	 * after it between sorts.
	 */
	private overlay(renderer: GraphRenderer): PixiContainer | null {
		let overlay = this.overlays.get(renderer);
		if (!overlay) {
			const PIXI = (window as unknown as { PIXI?: { Container: new () => PixiContainer } }).PIXI;
			if (!PIXI) return null;
			overlay = new PIXI.Container();
			overlay.eventMode = 'none';
			overlay.zIndex = 3;
			this.overlays.set(renderer, overlay);
		}
		const layer = renderer.hanger;
		if (layer.children[layer.children.length - 1] !== overlay) {
			if (overlay.parent) overlay.parent.removeChild(overlay);
			layer.addChild(overlay);
		}
		return overlay;
	}

	/**
	 * Draw a link above every other line and node, or put it back under the nodes.
	 * Raised links live in the overlay, below the rings. Moves only when the state changes.
	 */
	private setRaised(link: GraphLink, on: boolean): void {
		if (on) this.overlay(link.renderer); // keep the overlay on top
		if (on === this.raised.has(link)) return;
		const overlay = this.overlay(link.renderer);
		if (!overlay || !link.px) return;
		for (const part of [link.arrow, link.px]) {
			if (!part) continue;
			const from = on ? link.renderer.hanger : overlay;
			const to = on ? overlay : link.renderer.hanger;
			from.removeChild(part);
			to.addChildAt(part, 0);
		}
		if (on) this.raised.add(link);
		else this.raised.delete(link);
	}

	/** The colour a highlighted link takes at a node: its ring colour if it has a ring, else its dot colour. */
	private endColour(node: GraphNode, state: GraphState): number {
		// A ring set to match the note has a null colour, so it falls through to the dot colour too.
		return this.ringStyle(node, state)?.rgb ?? node.getFillColor().rgb;
	}

	/**
	 * A horizontal white texture fading from transparent (left) to opaque (right), shared
	 * by every blended link. Laid over a solid line tinted with the start colour and
	 * tinted with the end colour itself, it blends the line evenly from one to the other.
	 */
	private gradientTexture(): unknown {
		if (this.gradient) return this.gradient;
		const PIXI = (window as unknown as { PIXI?: { Texture: { from(source: HTMLCanvasElement): unknown } } }).PIXI;
		if (!PIXI) return null;
		const canvas = createEl('canvas', { attr: { width: 256, height: 1 } });
		const ctx = canvas.getContext('2d');
		if (!ctx) return null;
		const fill = ctx.createLinearGradient(0, 0, 256, 0);
		fill.addColorStop(0, 'rgba(255,255,255,0)');
		fill.addColorStop(1, 'rgba(255,255,255,1)');
		ctx.fillStyle = fill;
		ctx.fillRect(0, 0, 256, 1);
		this.gradient = PIXI.Texture.from(canvas);
		return this.gradient;
	}

	/**
	 * Lay the end colour over a highlighted link (null removes it). The line itself is
	 * already tinted with the start colour; this matches its size, place and opacity.
	 */
	private updateBlend(link: GraphLink, rgb: number | null): void {
		const line = link.line;
		if (rgb === null || !line || !link.px) {
			this.removeBlend(link);
			return;
		}
		let blend = this.blends.get(link);
		if (!blend) {
			const PIXI = (window as unknown as { PIXI?: { Sprite: new (texture: unknown) => PixiSprite } }).PIXI;
			const texture = this.gradientTexture();
			if (!PIXI || !texture) return;
			blend = new PIXI.Sprite(texture);
			blend.eventMode = 'none';
			link.px.addChild(blend);
			this.blends.set(link, blend);
		}
		blend.visible = line.visible;
		blend.x = line.x;
		blend.y = line.y;
		blend.width = line.width;
		blend.height = line.height;
		blend.alpha = line.alpha;
		blend.tint = rgb;
	}

	private removeBlend(link: GraphLink): void {
		const blend = this.blends.get(link);
		if (!blend) return;
		blend.parent?.removeChild(blend);
		blend.destroy();
		this.blends.delete(link);
	}

	/** The ring style for a node, or null if it has none. */
	private ringStyle(node: GraphNode, state: GraphState | undefined): RingStyle | null {
		const role = state?.roles.get(node.id);
		return role ? this.getStyle().ring[role] : null;
	}

	/** One screen pixel in node-local units, never thinner than Obsidian's own ring. */
	private onePixel(node: GraphNode): number {
		const r = node.renderer;
		return Math.max(1, 1 / r.scale / r.nodeScale);
	}

	/**
	 * How far from a node's centre its links should start, in graph units: the outer
	 * edge of its ring if it has one, otherwise null (Obsidian's own edge of the dot).
	 */
	private linkRadius(node: GraphNode, state: GraphState | undefined): number | null {
		const style = this.ringStyle(node, state);
		if (!style) return null;
		const px = this.onePixel(node);
		return (node.getSize() + style.gap * px + style.width * px) * node.renderer.nodeScale;
	}

	/**
	 * Draw (or remove) the ring around an open note. Drawn the same way Obsidian draws
	 * its hover ring: a PIXI.Graphics on the renderer's hanger, scaled with the nodes.
	 */
	private updateRing(node: GraphNode, state: GraphState | undefined): void {
		const style = this.ringStyle(node, state);
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
			const overlay = this.overlay(node.renderer);
			if (!overlay) return;
			overlay.addChild(ring);
			this.rings.set(node, ring);
		} else {
			this.overlay(node.renderer); // keep the overlay on top
		}

		const r = node.renderer;
		ring.visible = node.circle.visible;
		if (!ring.visible) return;
		const px = this.onePixel(node);
		const width = style.width * px;
		ring.x = node.x;
		ring.y = node.y;
		ring.scale.x = ring.scale.y = r.nodeScale;
		ring.alpha = node.fadeAlpha ?? 1;
		ring.clear();
		ring.lineStyle(width, style.rgb ?? node.getFillColor().rgb, 1);
		ring.drawCircle(0, 0, node.getSize() + style.gap * px + width / 2);
	}

	/** Remove rings left on node objects the graph has replaced (it rebuilds nodes on new data). */
	pruneRings(): void {
		for (const node of [...this.rings.keys()]) {
			if (node.renderer.nodeLookup[node.id] !== node) this.removeRing(node);
		}
		// Links whose graphics Obsidian has cleared.
		for (const link of [...this.blends.keys()]) {
			if (!link.px) this.removeBlend(link);
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
				if (state?.labelled.has(this.id)) showLabel(this);
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
				// Line colour is eased the same way, so restore its tint too.
				const base = self.linkBase.get(this);
				if (base) {
					if (this.line) {
						this.line.alpha = base.line;
						if (base.tint !== undefined) this.line.tint = base.tint;
					}
					if (this.arrow) this.arrow.alpha = base.arrow;
					self.linkBase.delete(this);
				}
				const result = orig.apply(this, args);

				const state = self.states.get(this.renderer);
				// A link to the active note is highlighted only if its other end is a connected
				// note, so links to tags stay plain when tags are excluded.
				const active = state?.connectedTo;
				const touchesActive =
					!!active &&
					((this.source.id === active && state.connected.has(this.target.id)) ||
						(this.target.id === active && state.connected.has(this.source.id)));
				// Highlighted links draw over other lines and nodes, so nothing breaks them up.
				self.setRaised(this, touchesActive);
				if (!state || !this.line) return result;
				trimToRings(this, self.linkRadius(this.source, state), self.linkRadius(this.target, state));
				const style = self.getStyle();
				const saved: { line: number; arrow: number; tint?: number } = {
					line: this.line.alpha,
					arrow: this.arrow?.alpha ?? 0,
				};
				let changed = false;

				if (style.dimLinks) {
					const factor = Math.min(nodeOpacity(state, this.source.id), nodeOpacity(state, this.target.id));
					this.line.alpha *= factor;
					if (this.arrow) this.arrow.alpha *= factor;
					changed = true;
				}

				// Colour links to the active note from the colour at one end (ring, or dot without
				// a ring) blending to the colour at the other, except while the mouse is over one
				// of their ends, when Obsidian's own hover highlight takes over.
				const hovered = this.renderer.getHighlightNode?.() ?? null;
				let blendTo: number | null = null;
				if (touchesActive && hovered !== this.source && hovered !== this.target) {
					const from = self.endColour(this.source, state);
					blendTo = self.endColour(this.target, state);
					saved.tint = this.line.tint;
					this.line.tint = from;
					if (this.arrow) this.arrow.tint = blendTo;
					changed = true;
				}
				self.updateBlend(this, blendTo);

				if (changed) self.linkBase.set(this, saved);
				return result;
			},
		);
	}
}
