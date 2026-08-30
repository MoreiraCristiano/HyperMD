import { dialogService } from '@/shared/ui/dialogs';
import { nodesForPaths, parentPath, selectedOperationNodes } from './explorerController';
import type { ExplorerOperations } from './explorerOperations';
import type { ExplorerSelection } from './explorerSelection.svelte';
import type { ExplorerTree } from './explorerTree.svelte';

type ExplorerCommandDependencies = {
  operations: ExplorerOperations;
  getRoot: () => string | null;
  tree: ExplorerTree;
  selection: ExplorerSelection;
  prompt: typeof dialogService.prompt;
  confirm: typeof dialogService.confirm;
  onOpenFile: (path: string) => Promise<boolean>;
  onError: (message: string) => void;
};

export class ExplorerCommands {
  constructor(private readonly dependencies: ExplorerCommandDependencies) {}

  async selectWorkspace(): Promise<void> {
    const result = await this.dependencies.operations.chooseWorkspace();
    if (!result.ok) this.dependencies.onError(result.error.message);
  }

  async createFile(): Promise<void> {
    const root = this.dependencies.getRoot();
    const parent = this.operationDirectory();
    if (!root || !parent) return;
    const name = await this.dependencies.prompt({
      title: 'New Markdown File',
      label: 'File name',
      value: 'new-file.md',
      confirmLabel: 'Create',
      required: true,
    });
    if (!name) return;
    const result = await this.dependencies.operations.createFile(root, parent, name);
    if (!result.ok) {
      this.dependencies.onError(result.error.message);
      return;
    }
    if (await this.dependencies.tree.refreshDirectory(parent, true)) return;
    try {
      await this.dependencies.onOpenFile(result.value);
    } catch (cause) {
      this.dependencies.onError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async createFolder(): Promise<void> {
    const root = this.dependencies.getRoot();
    const parent = this.operationDirectory();
    if (!root || !parent) return;
    const name = await this.dependencies.prompt({
      title: 'New Folder',
      label: 'Folder name',
      value: 'new-folder',
      confirmLabel: 'Create',
      required: true,
    });
    if (!name) return;
    const result = await this.dependencies.operations.createFolder(root, parent, name);
    if (!result.ok) {
      this.dependencies.onError(result.error.message);
      return;
    }
    await this.dependencies.tree.refreshDirectory(parent, true);
  }

  async renameSelected(): Promise<void> {
    const root = this.dependencies.getRoot();
    const nodes = nodesForPaths(this.dependencies.tree.entries, this.dependencies.selection.paths);
    const node = nodes.length === 1 ? nodes[0] : null;
    if (!root || !node) return;
    const name = await this.dependencies.prompt({
      title: 'Rename',
      label: 'New name',
      value: node.name,
      confirmLabel: 'Rename',
      required: true,
    });
    if (!name || name === node.name) return;
    const oldPath = node.path;
    const result = await this.dependencies.operations.rename(
      oldPath,
      name,
      node.isDirectory,
      node.type,
    );
    if (!result.ok) {
      this.dependencies.onError(result.error.message);
      return;
    }
    const move = { path: oldPath, newPath: result.value, isDirectory: node.isDirectory };
    this.dependencies.tree.applyMove(oldPath, result.value, parentPath(result.value));
    this.dependencies.selection.rewriteAfterMoves([move]);
    this.dependencies.selection.directory = node.isDirectory
      ? result.value
      : parentPath(result.value);
  }

  async deleteSelected(): Promise<void> {
    const root = this.dependencies.getRoot();
    const nodes = selectedOperationNodes(
      this.dependencies.tree.entries,
      this.dependencies.selection.paths,
    );
    if (!root || !nodes.length) return;
    const single = nodes.length === 1 ? nodes[0] : null;
    const label = single
      ? single.isDirectory
        ? `the folder “${single.name}” and all its contents`
        : `“${single.name}”`
      : `${nodes.length} selected items${nodes.some((node) => node.isDirectory) ? ', including folder contents' : ''}`;
    const confirmed = await this.dependencies.confirm({
      title: single
        ? single.isDirectory
          ? 'Delete Folder'
          : 'Delete File'
        : 'Delete Selected Items',
      message: `Delete ${label}? This action cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) return;
    const result = await this.dependencies.operations.delete(root, nodes);
    for (const node of result.value?.deleted ?? []) {
      this.dependencies.tree.remove(node);
      this.dependencies.selection.removeDeleted(node);
    }
    if (!result.ok) {
      this.dependencies.onError(result.error.message);
      return;
    }
    if (result.value.status === 'committed') this.dependencies.selection.clear();
  }

  private operationDirectory(): string | null {
    if (this.dependencies.selection.paths.length !== 1) return this.dependencies.getRoot();
    return this.dependencies.selection.directory ?? this.dependencies.getRoot();
  }
}
