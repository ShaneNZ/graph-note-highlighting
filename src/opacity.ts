import type { GraphRenderer, GraphState, TabRole } from './types';

export interface Seed {
	path: string;
	role: TabRole;
	/** How strongly this tab lights its neighbourhood, 0..1. */
	weight: number;
}

export interface OpacityOptions {
	/** Fraction of brightness kept per hop, 0..1. */
	fadePerHop: number;
	minOpacity: number;
}

/** Contributions smaller than this are treated as zero, which bounds the search depth. */
const CUTOFF = 0.01;
const MAX_DEPTH = 12;

/**
 * Hop distances from one node over the graph's own links, ignoring direction.
 * Uses the renderer's links, so the result respects the graph's filters
 * (hidden folders, tags on/off, orphans) and never sees unlinked mentions.
 */
function hopDistances(renderer: GraphRenderer, start: string, maxDepth: number): Map<string, number> {
	const dist = new Map<string, number>([[start, 0]]);
	let frontier = [start];
	for (let d = 1; d <= maxDepth && frontier.length > 0; d++) {
		const next: string[] = [];
		for (const id of frontier) {
			const node = renderer.nodeLookup[id];
			if (!node) continue;
			for (const neighbour of [...Object.keys(node.forward), ...Object.keys(node.reverse)]) {
				if (dist.has(neighbour) || !renderer.nodeLookup[neighbour]) continue;
				dist.set(neighbour, d);
				next.push(neighbour);
			}
		}
		frontier = next;
	}
	return dist;
}

/**
 * Each open tab contributes weight × fadePerHop^hops to every node it can reach.
 * Contributions combine like independent lights: 1 − Π(1 − c), so a note reached
 * by several open tabs is brighter than one reached by only one of them.
 */
export function computeState(renderer: GraphRenderer, seeds: Seed[], opts: OpacityOptions): GraphState {
	const fade = Math.min(Math.max(opts.fadePerHop, 0), 0.95);
	const maxDepth = fade <= 0 ? 0 : Math.min(MAX_DEPTH, Math.ceil(Math.log(CUTOFF) / Math.log(fade)));

	const darkness = new Map<string, number>(); // Π(1 − c)
	const roles = new Map<string, TabRole>();

	for (const seed of seeds) {
		if (!renderer.nodeLookup[seed.path]) continue;
		if (roles.get(seed.path) !== 'active') roles.set(seed.path, seed.role);

		for (const [id, hops] of hopDistances(renderer, seed.path, maxDepth)) {
			const c = seed.weight * Math.pow(fade, hops);
			if (c < CUTOFF) continue;
			darkness.set(id, (darkness.get(id) ?? 1) * (1 - c));
		}
	}

	const alpha = new Map<string, number>();
	for (const [id, dark] of darkness) alpha.set(id, 1 - dark);
	for (const id of roles.keys()) alpha.set(id, 1); // open notes are always fully visible

	return { alpha, roles, minOpacity: opts.minOpacity };
}

/** Final opacity for a node: the computed light, floored at the minimum. */
export function nodeOpacity(state: GraphState, id: string): number {
	const light = state.alpha.get(id) ?? 0;
	return state.minOpacity + (1 - state.minOpacity) * light;
}
