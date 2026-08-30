import { dialogService } from '@/shared/ui/dialogs';
import { parentPath, samePath, selectedOperationNodes } from './explorerController';
import type {
  ExplorerOperationError,
  ExplorerOperations,
  FileNode,
  WorkspaceMove,
} from './explorerOperations';
import type { ExplorerSelection } from './explorerSelection.svelte';
import type { ExplorerTree } from './explorerTree.svelte';

type ExplorerMoveDependencies = {
  operations: ExplorerOperations;
  getRoot: () => string | null;
  tree: ExplorerTree;
  selection: ExplorerSelection;
  prompt: typeof dialogService.prompt;
  onRenamed: (oldPath: string, newPath: string, isDirectory: boolean) => Promise<void>;
  onError: (message: string) => void;
};

export class ExplorerMoveController {
  constructor(private readonly dependencies: ExplorerMoveDependencies) {}

  async moveSelected(): Promise<void> {
    const root = this.dependencies.getRoot();
    const nodes = selectedOperationNodes(
      this.dependencies.tree.entries,
      this.dependencies.selection.paths,
    );
    if (!root || !nodes.length) return;
    const destination = await this.dependencies.prompt({
      title: 'Move',
      message:
        nodes.length === 1
          ? 'Enter a destination folder relative to the workspace. Use . for the root.'
          : `Move ${nodes.length} selected items. Enter a destination folder relative to the workspace.`,
      label: 'Destination folder',
      value: '.',
      confirmLabel: 'Move',
      required: true,
    });
    if (destination === null) return;
    const relativeDestination = destination.trim().replace(/\\/g, '/');
    const destinationPath =
      !relativeDestination || relativeDestination === '.'
        ? root
        : `${root.replace(/[\\/]+$/, '')}/${relativeDestination}`;
    await this.moveNodesToDirectory(nodes, destinationPath);
  }

  async moveNodesToDirectory(nodes: readonly FileNode[], destination: string): Promise<void> {
    const root = this.dependencies.getRoot();
    if (!root || !nodes.length) return;
    const result = await this.dependencies.operations.move(
      root,
      nodes.map((node) => ({ path: node.path, isDirectory: node.isDirectory })),
      destination,
    );
    if (result.ok) {
      try {
        await this.applyCommittedMoves(result.value, destination);
      } catch (cause) {
        this.dependencies.onError(cause instanceof Error ? cause.message : String(cause));
      }
      return;
    }
    if (result.error.kind === 'move-partial') {
      this.dependencies.onError(await this.reconcilePartialMove(result.error));
      return;
    }
    this.dependencies.onError(result.error.message);
  }

  private affectedDirectories(moves: readonly WorkspaceMove[]): string[] {
    const directories: string[] = [];
    for (const move of moves) {
      for (const directory of [parentPath(move.path), parentPath(move.newPath)]) {
        if (!directories.some((candidate) => samePath(candidate, directory))) {
          directories.push(directory);
        }
      }
    }
    return directories.sort(
      (left, right) => left.split(/[\\/]/).length - right.split(/[\\/]/).length,
    );
  }

  private async applyCommittedMoves(
    moves: readonly WorkspaceMove[],
    destination: string,
  ): Promise<void> {
    for (const move of moves) {
      this.dependencies.tree.applyMove(move.path, move.newPath, destination);
    }
    for (const move of moves) {
      await this.dependencies.onRenamed(move.path, move.newPath, move.isDirectory);
    }
    this.dependencies.selection.rewriteAfterMoves(moves);
    this.dependencies.selection.directory = destination;
  }

  private async reconcilePartialMove(
    error: Extract<ExplorerOperationError, { kind: 'move-partial' }>,
  ): Promise<string> {
    const reconciliationFailures: string[] = [];
    for (const directory of this.affectedDirectories(error.completed)) {
      const refreshError = await this.dependencies.tree.refreshDirectory(directory, true, false);
      if (refreshError) {
        reconciliationFailures.push(directory);
        console.error(
          `Failed to refresh workspace directory after partial move: ${directory}`,
          refreshError.cause,
        );
      }
    }
    this.dependencies.selection.rewriteAfterMoves(error.unrecovered);
    for (const move of error.unrecovered) {
      try {
        await this.dependencies.onRenamed(move.path, move.newPath, move.isDirectory);
      } catch (cause) {
        reconciliationFailures.push(move.newPath);
        console.error(`Failed to reconcile open tabs after partial move: ${move.newPath}`, cause);
      }
    }
    const items = error.unrecovered.map((move) => `${move.path} → ${move.newPath}`).join(', ');
    const reconciliationMessage = reconciliationFailures.length
      ? ` Reconciliation also failed for: ${reconciliationFailures.join(', ')}.`
      : '';
    return `Move failed: ${error.cause.message}. Rollback incomplete; items not recovered: ${items}.${reconciliationMessage}`;
  }
}
