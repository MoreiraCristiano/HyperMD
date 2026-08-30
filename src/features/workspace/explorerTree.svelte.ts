import {
  compareNodes,
  detachNode,
  findDirectory,
  preserveDirectoryState,
  rewriteNodePaths,
  samePath,
} from './explorerController';
import {
  pathName,
  type ExplorerOperationError,
  type ExplorerOperations,
  type FileNode,
} from './explorerOperations';
import type { ExplorerSelection } from './explorerSelection.svelte';

type ExplorerTreeDependencies = {
  operations: ExplorerOperations;
  getRoot: () => string | null;
  selection: ExplorerSelection;
  onError: (message: string) => void;
};

export class ExplorerTree {
  entries = $state<FileNode[]>([]);
  loading = $state(false);

  constructor(private readonly dependencies: ExplorerTreeDependencies) {}

  async loadRoot(reportError = true): Promise<ExplorerOperationError | null> {
    const root = this.dependencies.getRoot();
    if (!root) return null;
    this.loading = true;
    const result = await this.dependencies.operations.refresh(root, root);
    if (result.ok) {
      this.entries = result.value;
      this.dependencies.selection.clear();
    } else if (reportError) {
      this.dependencies.onError(result.error.message);
    }
    this.loading = false;
    return result.ok ? null : result.error;
  }

  async toggleDirectory(node: FileNode): Promise<void> {
    node.expanded = !node.expanded;
    if (!node.expanded) {
      this.dependencies.selection.removeCollapsedDescendants(node);
      return;
    }
    if (node.loaded || node.loading) return;
    const root = this.dependencies.getRoot();
    if (!root) return;
    node.loading = true;
    const result = await this.dependencies.operations.refresh(root, node.path);
    if (result.ok) {
      node.children = result.value;
      node.loaded = true;
    } else {
      this.dependencies.onError(result.error.message);
    }
    node.loading = false;
  }

  async refreshDirectory(
    path: string,
    preserveExpanded = false,
    reportError = true,
  ): Promise<ExplorerOperationError | null> {
    const root = this.dependencies.getRoot();
    if (!root) return null;
    if (path === root) {
      if (!preserveExpanded) return this.loadRoot(reportError);
      this.loading = true;
      const result = await this.dependencies.operations.refresh(root, root);
      if (result.ok) {
        this.entries = preserveDirectoryState(this.entries, result.value);
        this.dependencies.selection.clear();
      } else if (reportError) {
        this.dependencies.onError(result.error.message);
      }
      this.loading = false;
      return result.ok ? null : result.error;
    }
    const node = findDirectory(this.entries, path);
    if (!node) return this.loadRoot(reportError);
    const result = await this.dependencies.operations.refresh(root, path);
    if (!result.ok) {
      if (reportError) this.dependencies.onError(result.error.message);
      return result.error;
    }
    node.children = preserveExpanded
      ? preserveDirectoryState(node.children, result.value)
      : result.value;
    node.loaded = true;
    node.expanded = true;
    return null;
  }

  applyMove(oldPath: string, newPath: string, destination: string): void {
    const node = detachNode(this.entries, oldPath);
    if (!node) return;
    rewriteNodePaths(node, oldPath, newPath);
    node.name = pathName(newPath);
    const root = this.dependencies.getRoot();
    if (root && samePath(destination, root)) {
      this.entries.push(node);
      this.entries.sort(compareNodes);
      return;
    }
    const target = findDirectory(this.entries, destination);
    if (target?.loaded) {
      target.children.push(node);
      target.children.sort(compareNodes);
    }
  }

  remove(node: FileNode): void {
    detachNode(this.entries, node.path);
  }

  reset(): void {
    this.entries = [];
    this.loading = false;
  }
}
