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
	/** How many links away from an open note are lit up. */
	maxHops: number;
	/** Brightness at the last lit hop; it falls in even steps from 1 down to this. */
	minConnectedBrightness: number;
	minOpacity: number;
	/** Highlight the notes linked to the active note. */
	highlightConnected: boolean;
	/** Always show the names of notes linked to the active note (only while they are highlighted). */
	connectedShowNames: boolean;
	/** Always show the names of open notes. */
	openShowNames: boolean;
}


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
 * Brightness a note gets from one open note `hops` links away: full at the open note,
 * falling in even steps to the minimum at maxHops, and nothing beyond that.
 */
export function hopBrightness(hops: number, maxHops: number, minBrightness: number): number {
	if (hops > maxHops) return 0;
	if (maxHops <= 0) return 1;
	return 1 - ((1 - minBrightness) * hops) / maxHops;
}

/**
 * Each open tab contributes weight × hopBrightness to every node within maxHops.
 * Contributions combine like independent lights: 1 − Π(1 − c), so a note reached
 * by several open tabs is brighter than one reached by only one of them.
 */
export function computeState(renderer: GraphRenderer, seeds: Seed[], opts: OpacityOptions): GraphState {
	const maxHops = Math.max(0, Math.round(opts.maxHops));
	const minBrightness = Math.min(Math.max(opts.minConnectedBrightness, 0), 1);

	const darkness = new Map<string, number>(); // Π(1 − c)
	const tabRoles = new Map<string, TabRole>();

	for (const seed of seeds) {
		if (!renderer.nodeLookup[seed.path]) continue;
		if (tabRoles.get(seed.path) !== 'active') tabRoles.set(seed.path, seed.role);

		for (const [id, hops] of hopDistances(renderer, seed.path, maxHops, seed.includeTags)) {
			const c = seed.weight * hopBrightness(hops, maxHops, minBrightness);
			if (c <= 0) continue;
			darkness.set(id, (darkness.get(id) ?? 1) * (1 - c));
		}
	}

	const roles: Map<string, NodeRole> = tabRoles;
	const labelled = new Set<string>();
	if (opts.openShowNames) {
		for (const [id, role] of tabRoles) if (role === 'open') labelled.add(id);
	}

	// Notes one link from the active note. They are highlighted unless open in a tab themselves.
	const active = seeds.find((s) => s.role === 'active' && renderer.nodeLookup[s.path]);
	const connectedTo = opts.highlightConnected && active ? active.path : null;
	const connected = new Set<string>();
	if (active) {
		const node = renderer.nodeLookup[active.path]!;
		for (const id of [...Object.keys(node.forward), ...Object.keys(node.reverse)]) {
			if (id === active.path || !renderer.nodeLookup[id]) continue;
			if (!active.includeTags && isTag(renderer, id)) continue;
			if (connectedTo) connected.add(id);
			if (connectedTo && opts.connectedShowNames) labelled.add(id);
			if (connectedTo && !roles.has(id)) roles.set(id, 'connected');
		}
	}

	const alpha = new Map<string, number>();
	for (const [id, dark] of darkness) alpha.set(id, 1 - dark);
	for (const id of roles.keys()) alpha.set(id, 1); // highlighted notes are always fully visible

	return { alpha, roles, connectedTo, connected, labelled, minOpacity: opts.minOpacity };
}

/** Final opacity for a node: its brightness, never below the minimum opacity. */
export function nodeOpacity(state: GraphState, id: string): number {
	return Math.max(state.minOpacity, state.alpha.get(id) ?? 0);
}
