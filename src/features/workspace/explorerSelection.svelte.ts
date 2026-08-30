import {
  isDescendantPath,
  parentPath,
  rewriteMovedPath,
  samePath,
  visibleNodes,
} from './explorerController';
import type { FileNode, WorkspaceMove } from './explorerOperations';

export class ExplorerSelection {
  paths = $state<string[]>([]);
  anchorPath = $state<string | null>(null);
  directory = $state<string | null>(null);
  pathSet = $derived(new Set(this.paths));

  constructor(private readonly getRoot: () => string | null) {}

  selectSingle(node: FileNode): void {
    this.paths = [node.path];
    this.anchorPath = node.path;
    this.directory = node.isDirectory ? node.path : parentPath(node.path);
  }

  clear(): void {
    this.paths = [];
    this.anchorPath = null;
    this.directory = this.getRoot();
  }

  reset(root: string | null): void {
    this.paths = [];
    this.anchorPath = null;
    this.directory = root;
  }

  updateForClick(node: FileNode, entries: FileNode[], event: MouseEvent): boolean {
    const additive = event.ctrlKey || event.metaKey;
    if (event.shiftKey) {
      const visible = visibleNodes(entries);
      const anchorIndex = visible.findIndex((candidate) => candidate.path === this.anchorPath);
      const targetIndex = visible.findIndex((candidate) => samePath(candidate.path, node.path));
      if (anchorIndex === -1 || targetIndex === -1) {
        this.selectSingle(node);
      } else {
        const start = Math.min(anchorIndex, targetIndex);
        const end = Math.max(anchorIndex, targetIndex);
        const range = visible.slice(start, end + 1).map((candidate) => candidate.path);
        this.paths = additive ? [...new Set([...this.paths, ...range])] : range;
        this.directory = node.isDirectory ? node.path : parentPath(node.path);
      }
      return true;
    }
    if (additive) {
      this.paths = this.pathSet.has(node.path)
        ? this.paths.filter((path) => path !== node.path)
        : [...this.paths, node.path];
      this.anchorPath = node.path;
      this.directory = node.isDirectory ? node.path : parentPath(node.path);
      return true;
    }
    this.selectSingle(node);
    return false;
  }

  removeCollapsedDescendants(node: FileNode): void {
    this.paths = this.paths.filter((path) => !isDescendantPath(node.path, path));
    if (this.anchorPath && isDescendantPath(node.path, this.anchorPath)) {
      this.anchorPath = node.path;
    }
  }

  rewriteAfterMoves(moves: readonly WorkspaceMove[]): void {
    this.paths = this.paths.map((path) => rewriteMovedPath(path, moves));
    if (this.anchorPath) this.anchorPath = rewriteMovedPath(this.anchorPath, moves);
    if (this.directory) this.directory = rewriteMovedPath(this.directory, moves);
  }

  removeDeleted(node: FileNode): void {
    this.paths = this.paths.filter(
      (path) => !samePath(path, node.path) && !isDescendantPath(node.path, path),
    );
  }

  selectAll(entries: FileNode[]): void {
    const visible = visibleNodes(entries);
    this.paths = visible.map((node) => node.path);
    this.anchorPath = visible.at(-1)?.path ?? null;
    this.directory = this.getRoot();
  }
}
