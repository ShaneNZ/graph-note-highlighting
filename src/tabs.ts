import { FileView, type App, type WorkspaceLeaf } from 'obsidian';
import type { Seed } from './opacity';

export const GRAPH_VIEW_TYPES = ['graph', 'localgraph'];

/**
 * Which notes count as open, besides the active one. Notes showing in other
 * panes always count; on top of those:
 * - split: background tabs in the active note's tab group
 * - all: every background tab
 */
export type OpenScope = 'split' | 'all';

export interface TabOptions {
	/** Off: the active note gets no special treatment and counts as an open note. */
	highlightActive: boolean;
	/** Off: other open notes are not highlighted at all. */
	highlightOpen: boolean;
	openWeight: number;
	/** Whether highlighting travels through tag nodes (when the graph shows tags). */
	includeTags: boolean;
	includeSidebars: boolean;
	scope: OpenScope;
}

interface TabsParent {
	children?: WorkspaceLeaf[];
	currentTab?: number;
}

function parentOf(leaf: WorkspaceLeaf): TabsParent | undefined {
	return (leaf as unknown as { parent?: TabsParent }).parent;
}

/** False for leaves in a sidebar when sidebars are excluded. Collapsed sidebars are allowed through. */
function sidebarAllowed(app: App, leaf: WorkspaceLeaf, includeSidebars: boolean): boolean {
	const root = leaf.getRoot();
	return includeSidebars || (root !== app.workspace.leftSplit && root !== app.workspace.rightSplit);
}

/** True when the leaf is the selected tab in its group, and not inside a collapsed (or excluded) sidebar. */
function isShowing(app: App, leaf: WorkspaceLeaf, includeSidebars: boolean): boolean {
	const ws = app.workspace;
	const root = leaf.getRoot();
	if (!sidebarAllowed(app, leaf, includeSidebars)) return false;
	if ((root === ws.leftSplit || root === ws.rightSplit) && (root as unknown as { collapsed?: boolean }).collapsed) {
		return false;
	}
	const parent = (leaf as unknown as { parent?: TabsParent }).parent;
	if (parent?.children && typeof parent.currentTab === 'number') {
		return parent.children[parent.currentTab] === leaf;
	}
	return true;
}

/** True for a leaf showing a file in a normal tab (not a graph). */
export function isFileLeaf(leaf: WorkspaceLeaf | null): boolean {
	const view = leaf?.view;
	return view instanceof FileView && !!view.file && !GRAPH_VIEW_TYPES.includes(view.getViewType());
}

/**
 * The file a leaf holds, including background tabs Obsidian hasn't loaded yet
 * (deferred views have no `file`, but their saved view state names it).
 */
export function leafFilePath(app: App, leaf: WorkspaceLeaf): string | null {
	const view = leaf.view;
	if (view instanceof FileView) {
		if (GRAPH_VIEW_TYPES.includes(view.getViewType())) return null;
		return view.file?.path ?? null;
	}
	const state = leaf.getViewState();
	if (GRAPH_VIEW_TYPES.includes(state.type)) return null;
	const file = (state.state as { file?: unknown } | undefined)?.file;
	return typeof file === 'string' && app.vault.getFileByPath(file) ? file : null;
}

/**
 * The note being edited. When focus moves to a graph (or a sidebar panel), keep
 * the last note leaf that had focus, as long as it is still open.
 */
function activeLeaf(app: App, lastFileLeaf: WorkspaceLeaf | null): WorkspaceLeaf | null {
	const current = app.workspace.getActiveViewOfType(FileView);
	if (current?.file && isFileLeaf(current.leaf)) return current.leaf;
	let stillOpen = false;
	app.workspace.iterateAllLeaves((leaf) => {
		if (leaf === lastFileLeaf) stillOpen = true;
	});
	return stillOpen && isFileLeaf(lastFileLeaf) ? lastFileLeaf : null;
}

/** Whether a non-active leaf's note counts as open under the chosen scope. */
function counts(app: App, leaf: WorkspaceLeaf, active: WorkspaceLeaf | null, opts: TabOptions): boolean {
	if (isShowing(app, leaf, opts.includeSidebars)) return true;
	switch (opts.scope) {
		case 'split':
			return !!active && parentOf(leaf) === parentOf(active);
		case 'all':
			return sidebarAllowed(app, leaf, opts.includeSidebars);
	}
}

/**
 * The note being edited (active) plus the other open notes that count as
 * open under the chosen scope.
 */
export function collectSeeds(app: App, opts: TabOptions, lastFileLeaf: WorkspaceLeaf | null): Seed[] {
	const seeds: Seed[] = [];
	const active = activeLeaf(app, lastFileLeaf);
	const activePath = active ? leafFilePath(app, active) : null;
	if (activePath && (opts.highlightActive || opts.highlightOpen)) {
		seeds.push(
			opts.highlightActive
				? { path: activePath, role: 'active', weight: 1, includeTags: opts.includeTags }
				: { path: activePath, role: 'open', weight: opts.openWeight, includeTags: opts.includeTags },
		);
	}

	if (!opts.highlightOpen) return seeds;
	const seen = new Set(seeds.map((s) => s.path));
	app.workspace.iterateAllLeaves((leaf) => {
		const path = leafFilePath(app, leaf);
		if (!path || seen.has(path)) return;
		if (!counts(app, leaf, active, opts)) return;
		seen.add(path);
		seeds.push({ path, role: 'open', weight: opts.openWeight, includeTags: opts.includeTags });
	});
	return seeds;
}

/**
 * The tab that holds a note, if it is open anywhere. Prefers the tab that is
 * already active, then tabs in the main area, then sidebar tabs.
 */
export function findOpenLeaf(app: App, path: string): WorkspaceLeaf | null {
	const ws = app.workspace;
	const matches: WorkspaceLeaf[] = [];
	ws.iterateAllLeaves((leaf) => {
		if (leafFilePath(app, leaf) === path) matches.push(leaf);
	});
	const active = ws.getActiveViewOfType(FileView)?.leaf;
	return (
		matches.find((l) => l === active) ??
		matches.find((l) => l.getRoot() === ws.rootSplit) ??
		matches[0] ??
		null
	);
}
