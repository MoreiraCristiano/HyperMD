import {
  chooseWorkspace,
  createMarkdownFile,
  createWorkspaceFolder,
  moveWorkspaceEntries,
  pathName,
  readWorkspaceDirectory,
  relativeWorkspacePath,
  removeWorkspaceEntry,
  type FileNode,
  type WorkspaceEntryRef,
  type WorkspaceFileType,
  type WorkspaceMove,
  type WorkspaceMoveResult,
} from './workspaceService';

export { pathName };
export type { FileNode, WorkspaceFileType, WorkspaceMove };

export type ExplorerOperationName =
  'choose-workspace' | 'refresh' | 'create-file' | 'create-folder' | 'move' | 'rename' | 'delete';

export type ExplorerOperationError =
  | {
      kind: 'operation';
      operation: ExplorerOperationName;
      message: string;
      cause: unknown;
    }
  | {
      kind: 'move-rolled-back';
      operation: 'move';
      message: string;
      cause: Error;
    }
  | {
      kind: 'move-partial';
      operation: 'move';
      message: string;
      cause: Error;
      completed: WorkspaceMove[];
      recovered: WorkspaceMove[];
      unrecovered: WorkspaceMove[];
    };

export type ExplorerOperationResult<T> =
  { ok: true; value: T } | { ok: false; error: ExplorerOperationError; value?: T };

export type ExplorerDeleteResult = {
  status: 'committed' | 'cancelled' | 'partial';
  deleted: FileNode[];
};

export type ExplorerOperationsDependencies = {
  chooseWorkspace: () => Promise<string | null>;
  readDirectory: (root: string, path: string) => Promise<FileNode[]>;
  createFile: (root: string, parent: string, name: string) => Promise<string>;
  createFolder: (root: string, parent: string, name: string) => Promise<string>;
  moveEntries: (
    root: string,
    entries: readonly WorkspaceEntryRef[],
    requestedDirectory: string,
  ) => Promise<WorkspaceMoveResult>;
  removeEntry: (root: string, path: string, isDirectory: boolean) => Promise<void>;
  renameEntry: (
    oldPath: string,
    requestedName: string,
    isDirectory: boolean,
    fileType: WorkspaceFileType | null,
  ) => Promise<string>;
  beforeDelete: (path: string, isDirectory: boolean) => Promise<boolean>;
  deleted: (path: string, isDirectory: boolean) => void;
  changeWorkspace: (path: string) => Promise<boolean>;
};

type ExplorerOperationCallbacks = Pick<
  ExplorerOperationsDependencies,
  'renameEntry' | 'beforeDelete' | 'deleted' | 'changeWorkspace'
>;

function operationError(operation: ExplorerOperationName, cause: unknown): ExplorerOperationError {
  return {
    kind: 'operation',
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  };
}

export class ExplorerOperations {
  constructor(private readonly dependencies: ExplorerOperationsDependencies) {}

  async chooseWorkspace(): Promise<ExplorerOperationResult<string | null>> {
    return this.capture('choose-workspace', async () => {
      const path = await this.dependencies.chooseWorkspace();
      if (path) await this.dependencies.changeWorkspace(path);
      return path;
    });
  }

  async refresh(root: string, path: string): Promise<ExplorerOperationResult<FileNode[]>> {
    return this.capture('refresh', () => this.dependencies.readDirectory(root, path));
  }

  async createFile(
    root: string,
    parent: string,
    name: string,
  ): Promise<ExplorerOperationResult<string>> {
    return this.capture('create-file', () => this.dependencies.createFile(root, parent, name));
  }

  async createFolder(
    root: string,
    parent: string,
    name: string,
  ): Promise<ExplorerOperationResult<string>> {
    return this.capture('create-folder', () => this.dependencies.createFolder(root, parent, name));
  }

  async move(
    root: string,
    entries: readonly WorkspaceEntryRef[],
    destination: string,
  ): Promise<ExplorerOperationResult<WorkspaceMove[]>> {
    let result: WorkspaceMoveResult;
    try {
      const requestedDirectory = relativeWorkspacePath(root, destination) || '.';
      result = await this.dependencies.moveEntries(root, entries, requestedDirectory);
    } catch (cause) {
      return { ok: false, error: operationError('move', cause) };
    }
    if (result.status === 'committed') return { ok: true, value: result.moves };
    if (result.status === 'rolled-back') {
      return {
        ok: false,
        error: {
          kind: 'move-rolled-back',
          operation: 'move',
          message: `Move failed: ${result.cause.message}. Original state was restored; no items were left at the destination.`,
          cause: result.cause,
        },
      };
    }
    return {
      ok: false,
      error: {
        kind: 'move-partial',
        operation: 'move',
        message: `Move failed: ${result.cause.message}.`,
        cause: result.cause,
        completed: result.completed,
        recovered: result.recovered,
        unrecovered: result.unrecovered,
      },
    };
  }

  async rename(
    oldPath: string,
    requestedName: string,
    isDirectory: boolean,
    fileType: WorkspaceFileType | null,
  ): Promise<ExplorerOperationResult<string>> {
    return this.capture('rename', () =>
      this.dependencies.renameEntry(oldPath, requestedName, isDirectory, fileType),
    );
  }

  async delete(
    root: string,
    nodes: readonly FileNode[],
  ): Promise<ExplorerOperationResult<ExplorerDeleteResult>> {
    try {
      for (const node of nodes) {
        if (!(await this.dependencies.beforeDelete(node.path, node.isDirectory))) {
          return { ok: true, value: { status: 'cancelled', deleted: [] } };
        }
      }
    } catch (cause) {
      return { ok: false, error: operationError('delete', cause) };
    }

    const deleted: FileNode[] = [];
    for (const node of nodes) {
      try {
        await this.dependencies.removeEntry(root, node.path, node.isDirectory);
        deleted.push(node);
        this.dependencies.deleted(node.path, node.isDirectory);
      } catch (cause) {
        return {
          ok: false,
          error: operationError('delete', cause),
          value: { status: 'partial', deleted },
        };
      }
    }
    return { ok: true, value: { status: 'committed', deleted } };
  }

  private async capture<T>(
    operation: ExplorerOperationName,
    action: () => Promise<T>,
  ): Promise<ExplorerOperationResult<T>> {
    try {
      return { ok: true, value: await action() };
    } catch (cause) {
      return { ok: false, error: operationError(operation, cause) };
    }
  }
}

export function createExplorerOperations(
  callbacks: ExplorerOperationCallbacks,
): ExplorerOperations {
  return new ExplorerOperations({
    chooseWorkspace,
    readDirectory: readWorkspaceDirectory,
    createFile: createMarkdownFile,
    createFolder: createWorkspaceFolder,
    moveEntries: moveWorkspaceEntries,
    removeEntry: removeWorkspaceEntry,
    renameEntry: callbacks.renameEntry,
    beforeDelete: callbacks.beforeDelete,
    deleted: callbacks.deleted,
    changeWorkspace: callbacks.changeWorkspace,
  });
}
