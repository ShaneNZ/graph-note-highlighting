// Minimal shapes for Obsidian's undocumented graph internals.
// Verified against Obsidian 1.12 by inspecting a live graph view.

export interface GraphColor {
	a: number;
	rgb: number;
}

export interface PixiDisplay {
	alpha: number;
	visible: boolean;
	tint?: number;
}

/** The subset of PIXI.Graphics used to draw rings. */
export interface PixiGraphics extends PixiDisplay {
	x: number;
	y: number;
	zIndex: number;
	eventMode: string;
	scale: { x: number; y: number };
	parent: { removeChild(child: PixiGraphics): void } | null;
	clear(): void;
	lineStyle(width: number, color: number, alpha: number): void;
	drawCircle(x: number, y: number, radius: number): void;
	destroy(): void;
}

/** The graph's one flat layer (and our overlay). It isn't sorted, so later children draw on top. */
export interface PixiContainer {
	children: unknown[];
	parent: PixiContainer | null;
	eventMode: string;
	zIndex: number;
	destroy(): void;
	addChild(child: unknown): void;
	addChildAt(child: unknown, index: number): void;
	removeChild(child: unknown): void;
}

export interface GraphNode {
	id: string;
	type: string;
	forward: Record<string, unknown>;
	reverse: Record<string, unknown>;
	x: number;
	y: number;
	fadeAlpha: number;
	renderer: GraphRenderer;
	circle?: PixiDisplay;
	text?: PixiDisplay & { x: number; y: number; scale: { x: number; y: number } };
	/** Label offset Obsidian eases in while the node is hovered. */
	moveText?: number;
	getFillColor(): GraphColor;
	getSize(): number;
	render(): void;
}

/** A PIXI display object that can be placed and sized. */
export interface PixiSprite extends PixiDisplay {
	x: number;
	y: number;
	width: number;
	height: number;
	eventMode: string;
	parent: { removeChild(child: unknown): void } | null;
	destroy(): void;
}

export interface GraphLink {
	source: GraphNode;
	target: GraphNode;
	renderer: GraphRenderer;
	/** Container the line is drawn in, placed at the line's start and rotated along it. */
	px?: { x: number; y: number; parent: PixiContainer | null; addChild(child: unknown): void };
	line?: PixiSprite;
	arrow?: PixiSprite;
	render(): void;
}

export interface GraphRenderer {
	nodes: GraphNode[];
	links: GraphLink[];
	nodeLookup: Record<string, GraphNode>;
	hanger: PixiContainer;
	/** Zoom level. */
	scale: number;
	/** Label opacity for the current zoom level. */
	textAlpha: number;
	colors: { text: GraphColor };
	nodeScale: number;
	setData(data: unknown): void;
	changed(): void;
	/** The node under the mouse, whose links Obsidian highlights. */
	getHighlightNode?(): GraphNode | null;
}

export type TabRole = 'active' | 'open';

/** How a node is highlighted: open in a tab, or linked to the active note. */
export type NodeRole = TabRole | 'connected';

/** Per-renderer computed styling, looked up from the patched prototype methods. */
export interface GraphState {
	/** Opacity factor 0..1 for every node id reachable from a seed; others use the minimum. */
	alpha: Map<string, number>;
	/** Nodes that are open in a tab, or linked to the active note. */
	roles: Map<string, NodeRole>;
	/** The active note's id when its links are highlighted, otherwise null. */
	connectedTo: string | null;
	/** The active note's neighbours whose links are highlighted (tags left out when tags are excluded). */
	connected: Set<string>;
	/** Nodes whose names show at every zoom level. */
	labelled: Set<string>;
	minOpacity: number;
}
