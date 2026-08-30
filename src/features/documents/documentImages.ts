import { get } from 'svelte/store';
import { sidebarActions, sidebarState } from '@/features/workspace';
import { chooseWorkspace, listWorkspaceMarkdownFiles, pathName } from '@/features/workspace';
import { readMarkdownWithRevision, writeMarkdownSourceConditionally } from '@/platform/tauri/files';
import type { FileConflictKind } from '@/platform/tauri/atomicWrite';
import { dirname, normalize } from '@/platform/tauri/path';
import type { EditorApi, StoredSelection } from './documentTypes';
import { saveClipboardImage } from './editor/imageImport';
import { rewriteImageReferences } from './editor/imageReferences';
import { rewriteMarkdownImageReferences } from './editor/markdownImageReferences';
import { relativeMarkdownImagePath, validateWorkspaceImagePath } from './images/localImage';
import { isMarkdownTab, tabsState, type EditorTab, type TabsState } from './tabs/tabStore';

type DocumentImageServiceOptions = {
  getEditor: () => EditorApi | null;
  publish: (snapshot: TabsState) => void;
  scheduleAutoSave: (tab: EditorTab) => void;
};

export type ImageReferenceProgress = {
  phase: 'preflight' | 'commit' | 'rollback';
  completed: number;
  total: number;
  cancelable: boolean;
};

export type ImageReferenceDocumentPlan = {
  path: string;
  original: string;
  originalRevision: string;
  updated: string;
  committedRevision?: string;
};

export type ImageReferenceRenamePlan = {
  workspaceRoot: string;
  oldImagePath: string;
  newImagePath: string;
  documents: ImageReferenceDocumentPlan[];
};

export type ImageReferenceFailure =
  | { kind: 'conflict'; path: string; conflict: FileConflictKind }
  | { kind: 'io-error'; path: string; operation: string; message: string };

export type ImageReferenceWriteResult =
  | { status: 'committed'; completed: string[] }
  | {
      status: 'rolled-back';
      completed: string[];
      recovered: string[];
      failure: ImageReferenceFailure;
    }
  | {
      status: 'partial';
      completed: string[];
      recovered: string[];
      unrecovered: string[];
      failure: ImageReferenceFailure;
      rollbackFailures: Array<{ path: string; failure: ImageReferenceFailure }>;
    };

export type ImageReferenceOperationOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: ImageReferenceProgress) => void;
};

function comparablePath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return /^[A-Za-z]:/.test(normalized) ? normalized.toLowerCase() : normalized;
}

function operationError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

function assertNotCanceled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Image rename canceled.');
}

export class DocumentImageService {
  constructor(private readonly options: DocumentImageServiceOptions) {}

  async pasteClipboardImage(blob: Blob, selection: StoredSelection): Promise<boolean> {
    const editor = this.options.getEditor();
    if (!editor) return false;
    const initial = get(tabsState);
    const tabId = initial.activeId;
    const initialTab = initial.tabs.find((tab) => tab.id === tabId);
    if (!tabId || !initialTab || !isMarkdownTab(initialTab)) return false;

    let workspaceRoot = get(sidebarState).workspacePath;
    if (!workspaceRoot) {
      workspaceRoot = await chooseWorkspace();
      if (!workspaceRoot) return false;
      sidebarActions.setWorkspace(workspaceRoot, pathName(workspaceRoot));
    }

    const imported = await saveClipboardImage(blob, workspaceRoot, initialTab.path);
    sidebarActions.refreshWorkspace(workspaceRoot);
    const snapshot = get(tabsState);
    const tab = snapshot.tabs.find((candidate) => candidate.id === tabId);
    if (!tab || !isMarkdownTab(tab)) return false;

    if (snapshot.activeId === tabId) {
      return editor.insertImage(imported.markdownSrc, 'image', selection);
    }

    tab.state = editor.insertImageIntoState(tab.state, imported.markdownSrc, 'image', selection);
    tab.dirty = !tab.state.doc.eq(tab.savedDoc);
    this.options.publish({ ...snapshot, tabs: [...snapshot.tabs] });
    return true;
  }

  async insertWorkspaceImage(path: string, selection: StoredSelection): Promise<boolean> {
    const editor = this.options.getEditor();
    if (!editor) return false;
    const initial = get(tabsState);
    const tabId = initial.activeId;
    const initialTab = initial.tabs.find((tab) => tab.id === tabId);
    if (!tabId || !initialTab || !isMarkdownTab(initialTab)) return false;

    const workspaceRoot = get(sidebarState).workspacePath;
    if (!workspaceRoot) return false;
    const imagePath = await validateWorkspaceImagePath(path);
    const documentDirectory = initialTab.path ? await dirname(initialTab.path) : workspaceRoot;
    const markdownSrc = relativeMarkdownImagePath(await normalize(documentDirectory), imagePath);
    const snapshot = get(tabsState);
    const tab = snapshot.tabs.find((candidate) => candidate.id === tabId);
    if (!tab || !isMarkdownTab(tab)) return false;

    if (snapshot.activeId === tabId) return editor.insertImage(markdownSrc, '', selection);

    tab.state = editor.insertImageIntoState(tab.state, markdownSrc, '', selection);
    tab.dirty = !tab.state.doc.eq(tab.savedDoc);
    this.options.publish({ ...snapshot, tabs: [...snapshot.tabs] });
    return true;
  }

  async planWorkspaceImageReferenceRename(
    workspaceRoot: string,
    oldImagePath: string,
    newImagePath: string,
    options: ImageReferenceOperationOptions = {},
  ): Promise<ImageReferenceRenamePlan> {
    const editor = this.options.getEditor();
    if (!editor) throw new Error('The editor is not ready.');
    assertNotCanceled(options.signal);
    options.onProgress?.({
      phase: 'preflight',
      completed: 0,
      total: 0,
      cancelable: true,
    });
    const markdownPaths = await listWorkspaceMarkdownFiles(workspaceRoot);
    assertNotCanceled(options.signal);
    const documents: ImageReferenceDocumentPlan[] = [];
    options.onProgress?.({
      phase: 'preflight',
      completed: 0,
      total: markdownPaths.length,
      cancelable: true,
    });
    for (let index = 0; index < markdownPaths.length; index += 1) {
      assertNotCanceled(options.signal);
      const documentPath = markdownPaths[index];
      const read = await readMarkdownWithRevision(documentPath);
      if (read.status === 'io-error') throw new Error(read.message);
      const original = read.contents;
      const rewritten = await rewriteMarkdownImageReferences(
        original,
        documentPath,
        oldImagePath,
        newImagePath,
      );
      assertNotCanceled(options.signal);
      if (rewritten.changed) {
        documents.push({
          path: documentPath,
          original,
          originalRevision: read.revision,
          updated: rewritten.source,
        });
      }
      options.onProgress?.({
        phase: 'preflight',
        completed: index + 1,
        total: markdownPaths.length,
        cancelable: true,
      });
    }
    return { workspaceRoot, oldImagePath, newImagePath, documents };
  }

  async writeWorkspaceImageReferencePlan(
    plan: ImageReferenceRenamePlan,
    options: Pick<ImageReferenceOperationOptions, 'onProgress'> = {},
  ): Promise<ImageReferenceWriteResult> {
    const completed: Array<{ document: ImageReferenceDocumentPlan; revision: string }> = [];
    options.onProgress?.({
      phase: 'commit',
      completed: 0,
      total: plan.documents.length,
      cancelable: false,
    });
    try {
      for (let index = 0; index < plan.documents.length; index += 1) {
        const document = plan.documents[index];
        const result = await writeMarkdownSourceConditionally(document.path, document.updated, {
          state: 'revision',
          revision: document.originalRevision,
        });
        if (result.status !== 'success') {
          const failure: ImageReferenceFailure =
            result.status === 'conflict'
              ? { kind: 'conflict', path: document.path, conflict: result.kind }
              : {
                  kind: 'io-error',
                  path: document.path,
                  operation: result.operation,
                  message: result.message,
                };
          return this.rollbackReferenceWrites(completed, failure, options);
        }
        completed.push({ document, revision: result.revision });
        document.committedRevision = result.revision;
        options.onProgress?.({
          phase: 'commit',
          completed: index + 1,
          total: plan.documents.length,
          cancelable: false,
        });
      }
      return { status: 'committed', completed: completed.map(({ document }) => document.path) };
    } catch (cause) {
      return this.rollbackReferenceWrites(
        completed,
        {
          kind: 'io-error',
          path: completed.at(-1)?.document.path ?? plan.documents[0]?.path ?? '',
          operation: 'unexpected',
          message: operationError(cause).message,
        },
        options,
      );
    }
  }

  private async rollbackReferenceWrites(
    completed: Array<{ document: ImageReferenceDocumentPlan; revision: string }>,
    failure: ImageReferenceFailure,
    options: Pick<ImageReferenceOperationOptions, 'onProgress'>,
  ): Promise<ImageReferenceWriteResult> {
    const recovered: string[] = [];
    const rollbackFailures: Array<{ path: string; failure: ImageReferenceFailure }> = [];
    options.onProgress?.({
      phase: 'rollback',
      completed: 0,
      total: completed.length,
      cancelable: false,
    });
    const rollbackDocuments = [...completed].reverse();
    for (let index = 0; index < rollbackDocuments.length; index += 1) {
      const completedWrite = rollbackDocuments[index];
      const { document } = completedWrite;
      const rollback = await writeMarkdownSourceConditionally(document.path, document.original, {
        state: 'revision',
        revision: completedWrite.revision,
      });
      if (rollback.status === 'success') {
        recovered.push(document.path);
        delete document.committedRevision;
      } else {
        delete document.committedRevision;
        rollbackFailures.push({
          path: document.path,
          failure:
            rollback.status === 'conflict'
              ? { kind: 'conflict', path: document.path, conflict: rollback.kind }
              : {
                  kind: 'io-error',
                  path: document.path,
                  operation: rollback.operation,
                  message: rollback.message,
                },
        });
      }
      options.onProgress?.({
        phase: 'rollback',
        completed: index + 1,
        total: rollbackDocuments.length,
        cancelable: false,
      });
    }
    const completedPaths = completed.map(({ document }) => document.path);
    if (rollbackFailures.length === 0) {
      return {
        status: 'rolled-back',
        completed: completedPaths,
        recovered,
        failure,
      };
    }
    return {
      status: 'partial',
      completed: completedPaths,
      recovered,
      unrecovered: rollbackFailures.map(({ path }) => path),
      failure,
      rollbackFailures,
    };
  }

  async reconcileWorkspaceImageReferencePlan(
    plan: ImageReferenceRenamePlan,
    documentsAtDestination: readonly string[],
  ): Promise<void> {
    const editor = this.options.getEditor();
    if (!editor || documentsAtDestination.length === 0) return;
    const destinationPaths = new Set(documentsAtDestination.map(comparablePath));
    for (const document of plan.documents) {
      if (!destinationPaths.has(comparablePath(document.path))) continue;
      const tabId = get(tabsState).tabs.find(
        (tab) =>
          isMarkdownTab(tab) &&
          tab.path !== null &&
          comparablePath(tab.path) === comparablePath(document.path),
      )?.id;
      if (!tabId) continue;
      while (true) {
        const snapshot = get(tabsState);
        const tab = snapshot.tabs.find((candidate) => candidate.id === tabId);
        if (
          !tab ||
          !isMarkdownTab(tab) ||
          !tab.path ||
          comparablePath(tab.path) !== comparablePath(document.path)
        ) {
          break;
        }
        const originalState = tab.state;
        const rewritten = await rewriteImageReferences(
          originalState,
          document.path,
          plan.oldImagePath,
          plan.newImagePath,
        );
        const latest = get(tabsState);
        const latestTab = latest.tabs.find((candidate) => candidate.id === tabId);
        if (
          !latestTab ||
          !isMarkdownTab(latestTab) ||
          !latestTab.path ||
          comparablePath(latestTab.path) !== comparablePath(document.path)
        ) {
          break;
        }
        if (latestTab.state !== originalState) continue;
        latestTab.state = rewritten.state;
        latestTab.savedDoc = editor.createState(document.updated).doc;
        latestTab.sourceSnapshot = {
          source: document.updated,
          canonical: editor.serializeNode(latestTab.savedDoc),
        };
        latestTab.diskRevision = document.committedRevision ?? null;
        latestTab.dirty = !latestTab.state.doc.eq(latestTab.savedDoc);
        this.options.publish({ ...latest, tabs: [...latest.tabs] });
        if (latest.activeId === tabId) editor.setState(rewritten.state);
        this.options.scheduleAutoSave(latestTab);
        break;
      }
    }
  }

  async updateWorkspaceImageReferences(
    workspaceRoot: string,
    oldImagePath: string,
    newImagePath: string,
  ): Promise<void> {
    const plan = await this.planWorkspaceImageReferenceRename(
      workspaceRoot,
      oldImagePath,
      newImagePath,
    );
    const result = await this.writeWorkspaceImageReferencePlan(plan);
    if (result.status === 'committed') {
      await this.reconcileWorkspaceImageReferencePlan(plan, result.completed);
      return;
    }
    if (result.status === 'partial') {
      await this.reconcileWorkspaceImageReferencePlan(plan, result.unrecovered);
      throw new Error(
        `Could not recover Markdown files: ${result.unrecovered.join(', ')}. ${result.failure.kind === 'conflict' ? 'A file changed externally.' : result.failure.message}`,
      );
    }
    throw new Error(
      result.failure.kind === 'conflict'
        ? `Image reference conflict in ${result.failure.path}.`
        : result.failure.message,
    );
  }
}
