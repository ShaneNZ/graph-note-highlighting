import type { GraphRenderer, GraphState, NodeRole, TabRole } from './types';

export interface Seed {
	path: string;
	role: TabRole;
	/** How strongly this tab lights its neighbourhood, 0..1. */
	weight: number;
	/** Whether the light travels through tag nodes (when the graph shows tags). */
	includeTags: boolean;
}

export interface OpacityOptions {
	/** Fraction of brightness kept per hop, 0..1. */
	fadePerHop: number;
	minOpacity: number;
	/** Highlight the notes linked to the active note. */
	highlightConnected: boolean;
}

/** Contributions smaller than this are treated as zero, which bounds the search depth. */
const CUTOFF = 0.01;
const MAX_DEPTH = 12;

function isTag(renderer: GraphRenderer, id: string): boolean {
	return renderer.nodeLookup[id]?.type === 'tag';
}

/**
 * Hop distances from one node over the graph's own links, ignoring direction.
 * With includeTags off, tag nodes are neither reached nor travelled through.
 * Uses the renderer's links, so the result respects the graph's filters
 * (hidden folders, tags on/off, orphans) and never sees unlinked mentions.
 */
function hopDistances(
	renderer: GraphRenderer,
	start: string,
	maxDepth: number,
	includeTags: boolean,
): Map<string, number> {
	const dist = new Map<string, number>([[start, 0]]);
	let frontier = [start];
	for (let d = 1; d <= maxDepth && frontier.length > 0; d++) {
		const next: string[] = [];
		for (const id of frontier) {
			const node = renderer.nodeLookup[id];
			if (!node) continue;
			for (const neighbour of [...Object.keys(node.forward), ...Object.keys(node.reverse)]) {
				if (dist.has(neighbour) || !renderer.nodeLookup[neighbour]) continue;
				if (!includeTags && isTag(renderer, neighbour)) continue;
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
	const tabRoles = new Map<string, TabRole>();

	for (const seed of seeds) {
		if (!renderer.nodeLookup[seed.path]) continue;
		if (tabRoles.get(seed.path) !== 'active') tabRoles.set(seed.path, seed.role);

		for (const [id, hops] of hopDistances(renderer, seed.path, maxDepth, seed.includeTags)) {
			const c = seed.weight * Math.pow(fade, hops);
			if (c < CUTOFF) continue;
			darkness.set(id, (darkness.get(id) ?? 1) * (1 - c));
		}
	}

	// Notes one link from the active note, unless they are open in a tab themselves.
	const roles: Map<string, NodeRole> = tabRoles;
	const active = seeds.find((s) => s.role === 'active' && renderer.nodeLookup[s.path]);
	const connectedTo = opts.highlightConnected && active ? active.path : null;
	if (connectedTo) {
		const node = renderer.nodeLookup[connectedTo]!;
		for (const id of [...Object.keys(node.forward), ...Object.keys(node.reverse)]) {
			if (!renderer.nodeLookup[id] || roles.has(id)) continue;
			if (!active!.includeTags && isTag(renderer, id)) continue;
			roles.set(id, 'connected');
		}
	}

	const alpha = new Map<string, number>();
	for (const [id, dark] of darkness) alpha.set(id, 1 - dark);
	for (const id of roles.keys()) alpha.set(id, 1); // highlighted notes are always fully visible

	return { alpha, roles, connectedTo, minOpacity: opts.minOpacity };
}

/** Final opacity for a node: the computed light, floored at the minimum. */
export function nodeOpacity(state: GraphState, id: string): number {
	const light = state.alpha.get(id) ?? 0;
	return state.minOpacity + (1 - state.minOpacity) * light;
}
