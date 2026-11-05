// Minimal shapes for Obsidian's undocumented graph internals.
// Verified against Obsidian 1.12 by inspecting a live graph view.

export interface GraphColor {
	a: number;
	rgb: number;
}

export interface PixiDisplay {
	alpha: number;
}

export interface GraphNode {
	id: string;
	type: string;
	forward: Record<string, unknown>;
	reverse: Record<string, unknown>;
	renderer: GraphRenderer;
	text?: PixiDisplay;
	getFillColor(): GraphColor;
	getSize(): number;
	render(): void;
}

export interface GraphLink {
	source: GraphNode;
	target: GraphNode;
	renderer: GraphRenderer;
	line?: PixiDisplay;
	arrow?: PixiDisplay;
	render(): void;
}

export interface GraphRenderer {
	nodes: GraphNode[];
	links: GraphLink[];
	nodeLookup: Record<string, GraphNode>;
	setData(data: unknown): void;
	changed(): void;
}

export type TabRole = 'active' | 'visible';

/** Per-renderer computed styling, looked up from the patched prototype methods. */
export interface GraphState {
	/** Opacity factor 0..1 for every node id reachable from a seed; others use the minimum. */
	alpha: Map<string, number>;
	/** Nodes that are open in a tab. */
	roles: Map<string, TabRole>;
	minOpacity: number;
}
