import { FileView, type App, type WorkspaceLeaf } from 'obsidian';
import type { Seed } from './opacity';

export const GRAPH_VIEW_TYPES = ['graph', 'localgraph'];

export interface TabOptions {
	visibleWeight: number;
	includeSidebars: boolean;
}

interface TabsParent {
	children?: WorkspaceLeaf[];
	currentTab?: number;
}

/** True when the leaf is the selected tab in its group, and not inside a collapsed (or excluded) sidebar. */
function isShowing(app: App, leaf: WorkspaceLeaf, includeSidebars: boolean): boolean {
	const ws = app.workspace;
	const root = leaf.getRoot();
	if (root === ws.leftSplit || root === ws.rightSplit) {
		if (!includeSidebars) return false;
		if ((root as unknown as { collapsed?: boolean }).collapsed) return false;
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
 * The note being edited. When focus moves to a graph (or a sidebar panel), keep
 * the last note leaf that had focus, as long as it is still open.
 */
function activeFilePath(app: App, lastFileLeaf: WorkspaceLeaf | null): string | null {
	const current = app.workspace.getActiveViewOfType(FileView);
	if (current?.file && isFileLeaf(current.leaf)) return current.file.path;
	let stillOpen = false;
	app.workspace.iterateAllLeaves((leaf) => {
		if (leaf === lastFileLeaf) stillOpen = true;
	});
	if (stillOpen && lastFileLeaf && isFileLeaf(lastFileLeaf)) {
		return (lastFileLeaf.view as FileView).file?.path ?? null;
	}
	return null;
}

/**
 * The note being edited (active) plus every other note that is on screen
 * in another pane (visible). Background tabs are ignored.
 */
export function collectSeeds(app: App, opts: TabOptions, lastFileLeaf: WorkspaceLeaf | null): Seed[] {
	const seeds: Seed[] = [];
	const active = activeFilePath(app, lastFileLeaf);
	if (active) seeds.push({ path: active, role: 'active', weight: 1 });

	const seen = new Set(seeds.map((s) => s.path));
	app.workspace.iterateAllLeaves((leaf) => {
		const view = leaf.view;
		if (!(view instanceof FileView) || !view.file) return;
		if (GRAPH_VIEW_TYPES.includes(view.getViewType())) return;
		if (seen.has(view.file.path)) return;
		if (!isShowing(app, leaf, opts.includeSidebars)) return;
		seen.add(view.file.path);
		seeds.push({ path: view.file.path, role: 'visible', weight: opts.visibleWeight });
	});
	return seeds;
}
