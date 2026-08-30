import {
  chooseSavePath,
  fileName,
  readMarkdownWithRevision,
  writeMarkdownSourceConditionally,
} from '@/platform/tauri/files';
import type { ConditionalWriteResult, FileConflictKind } from '@/platform/tauri/atomicWrite';
import { dialogService } from '@/shared/ui/dialogs';
import { isImagePath } from '@/shared/utils/imageTypes';
import { validateWorkspaceImagePath } from './images/localImage';
import { isMarkdownTab, type EditorTab, type TabsState } from './tabs/tabStore';
import type { EditorApi } from './editor/editorTypes';
import { mergeMarkdownSource } from './markdownSource';

export interface DocumentPersistenceService {
  open(path: string): Promise<boolean>;
  save(id: string | null, saveAs?: boolean, source?: 'manual' | 'auto'): Promise<boolean>;
  waitForSave(id: string): Promise<void>;
}

type DocumentPersistenceOptions = {
  getEditor: () => EditorApi | null;
  getTabs: () => TabsState;
  publish: (snapshot: TabsState) => void;
  activate: (id: string) => void;
  scheduleAutoSave: (tab: EditorTab) => void;
  reportWarning: (message: string) => void;
};

function comparablePath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return /^[A-Za-z]:/.test(normalized) ? normalized.toLowerCase() : normalized;
}

export class DocumentPersistence implements DocumentPersistenceService {
  private readonly saveQueues = new Map<string, Promise<void>>();
  private readonly activeSavePaths = new Map<string, string>();

  constructor(private readonly options: DocumentPersistenceOptions) {}

  async open(path: string): Promise<boolean> {
    const editor = this.options.getEditor();
    if (!editor) return false;
    const existing = this.options
      .getTabs()
      .tabs.find((tab) => tab.path && comparablePath(tab.path) === comparablePath(path));
    if (existing) {
      this.options.activate(existing.id);
      return true;
    }

    if (isImagePath(path)) return this.openImage(path);
    if (!path.toLowerCase().endsWith('.md')) throw new Error('Unsupported file type.');

    const read = await readMarkdownWithRevision(path);
    if (read.status === 'io-error') throw new Error(read.message);
    const markdown = read.contents.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const state = editor.createState(markdown);
    const canonical = editor.serializeState(state);
    const tab: EditorTab = {
      id: crypto.randomUUID(),
      path,
      name: fileName(path),
      type: 'markdown',
      pinned: false,
      state,
      savedDoc: state.doc,
      sourceSnapshot: { source: read.contents, canonical },
      dirty: false,
      missing: false,
      diskRevision: read.revision,
    };
    const snapshot = this.options.getTabs();
    this.options.publish({ ...snapshot, tabs: [...snapshot.tabs, tab], activeId: tab.id });
    editor.setState(state);
    editor.focus();
    return true;
  }

  async save(
    id: string | null,
    saveAs = false,
    source: 'manual' | 'auto' = 'manual',
  ): Promise<boolean> {
    if (!this.options.getEditor() || !id) return false;
    const previous = this.saveQueues.get(id) ?? Promise.resolve();
    const operation = previous.then(() => this.performSave(id, saveAs, source));
    const tail = operation.then(
      () => undefined,
      () => undefined,
    );
    this.saveQueues.set(id, tail);
    try {
      return await operation;
    } finally {
      if (this.saveQueues.get(id) === tail) this.saveQueues.delete(id);
    }
  }

  async waitForSave(id: string): Promise<void> {
    await this.saveQueues.get(id);
  }

  private async openImage(path: string): Promise<boolean> {
    const validatedPath = await validateWorkspaceImagePath(path);
    const tab: EditorTab = {
      id: crypto.randomUUID(),
      path: validatedPath,
      name: fileName(validatedPath),
      type: 'image',
      pinned: false,
      dirty: false,
      missing: false,
    };
    const snapshot = this.options.getTabs();
    this.options.publish({ ...snapshot, tabs: [...snapshot.tabs, tab], activeId: tab.id });
    return true;
  }

  private async performSave(
    id: string,
    saveAs: boolean,
    source: 'manual' | 'auto',
  ): Promise<boolean> {
    const editor = this.options.getEditor();
    if (!editor) return false;
    const snapshot = this.options.getTabs();
    const tab = snapshot.tabs.find((candidate) => candidate.id === id);
    if (!tab) return false;
    if (!isMarkdownTab(tab)) return true;
    if (snapshot.activeId === id) tab.state = editor.getState();

    const savedState = tab.state;
    const currentCanonical = editor.serializeState(savedState);
    const savedCanonical = editor.serializeNode(tab.savedDoc);
    const sourceSnapshot = tab.sourceSnapshot ?? {
      source: savedCanonical,
      canonical: savedCanonical,
    };
    const merged = mergeMarkdownSource(sourceSnapshot, currentCanonical, (markdown) =>
      editor.serializeState(
        editor.createState(markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n')),
      ),
    );
    let markdown: string;
    let forceNormalizedSaveAs = false;
    if (merged.status === 'conflict') {
      if (source === 'auto') {
        this.options.reportWarning(
          `Auto Save stopped because “${tab.name}” cannot be updated without changing unsupported Markdown. Your edits remain unsaved.`,
        );
        return false;
      }
      const choice = await dialogService.choose({
        title: 'Markdown cannot be saved losslessly',
        message:
          'These edits overlap Markdown syntax the visual editor cannot preserve. Cancel or save a normalized copy while leaving the original file unchanged.',
        tone: 'warning',
        actions: [
          { id: 'cancel', label: 'Cancel', variant: 'secondary' },
          { id: 'save-as', label: 'Save Normalized Copy…', variant: 'primary' },
        ],
      });
      if (choice !== 'save-as') return false;
      markdown = currentCanonical;
      forceNormalizedSaveAs = true;
    } else {
      markdown = merged.source;
    }

    const originalPath = tab.path;
    let path = originalPath;
    let explicitPath = !path || saveAs || tab.missing || forceNormalizedSaveAs;
    if (explicitPath) path = await chooseSavePath(path ?? tab.name);
    if (!path) return false;
    if (!explicitPath && markdown === sourceSnapshot.source && savedState.doc.eq(tab.savedDoc)) {
      return true;
    }
    let releasePath = this.reserveSavePath(id, path);
    try {
      let result: ConditionalWriteResult =
        explicitPath || !tab.diskRevision
          ? tab.diskRevision || explicitPath
            ? await writeMarkdownSourceConditionally(path, markdown, { state: 'any' })
            : { status: 'conflict', kind: 'changed', actualRevision: null }
          : await writeMarkdownSourceConditionally(path, markdown, {
              state: 'revision',
              revision: tab.diskRevision,
            });

      if (result.status === 'conflict') {
        if (source === 'auto') {
          this.options.reportWarning(this.conflictMessage(tab.name, result.kind, true));
          return false;
        }
        const choice = await dialogService.choose({
          title: 'File changed outside HyperMD',
          message: this.conflictMessage(tab.name, result.kind, false),
          tone: 'warning',
          actions: [
            { id: 'cancel', label: 'Cancel', variant: 'secondary' },
            { id: 'save-as', label: 'Save As…', variant: 'secondary' },
            { id: 'overwrite', label: 'Overwrite', variant: 'danger' },
          ],
        });
        if (!choice || choice === 'cancel') return false;
        if (choice === 'save-as') {
          releasePath();
          releasePath = () => {};
          const selected = await chooseSavePath(path);
          if (!selected) return false;
          path = selected;
          explicitPath = true;
          releasePath = this.reserveSavePath(id, path);
        }
        result = await writeMarkdownSourceConditionally(path, markdown, { state: 'any' });
      }

      if (result.status === 'io-error') {
        releasePath();
        releasePath = () => {};
        if (explicitPath || !originalPath) throw new Error(result.message);
        const authorizedPath = await chooseSavePath(path);
        if (!authorizedPath) return false;
        path = authorizedPath;
        releasePath = this.reserveSavePath(id, path);
        result = await writeMarkdownSourceConditionally(path, markdown, { state: 'any' });
      }
      if (result.status === 'conflict') return false;
      if (result.status === 'io-error') throw new Error(result.message);
      tab.path = path;
      tab.name = fileName(path);
      tab.savedDoc = savedState.doc;
      tab.sourceSnapshot = { source: markdown, canonical: currentCanonical };
      tab.dirty = !tab.state.doc.eq(tab.savedDoc);
      tab.missing = false;
      tab.diskRevision = result.revision;
      this.options.publish({ ...snapshot, tabs: [...snapshot.tabs] });
      this.options.scheduleAutoSave(tab);
      return true;
    } finally {
      releasePath();
    }
  }

  private conflictMessage(name: string, kind: FileConflictKind, autoSave: boolean): string {
    const change =
      kind === 'missing'
        ? 'was removed outside HyperMD'
        : kind === 'exists'
          ? 'was created outside HyperMD'
          : 'was changed outside HyperMD';
    return autoSave
      ? `Auto Save stopped because “${name}” ${change}. Your edits remain unsaved.`
      : `“${name}” ${change}. Cancel, save to another path, or explicitly overwrite it.`;
  }

  private reserveSavePath(id: string, path: string): () => void {
    const key = comparablePath(path);
    const duplicate = this.options
      .getTabs()
      .tabs.some(
        (candidate) =>
          candidate.id !== id && candidate.path !== null && comparablePath(candidate.path) === key,
      );
    if (duplicate || this.activeSavePaths.has(key)) {
      throw new Error('This file is already open in another tab.');
    }
    this.activeSavePaths.set(key, id);
    return () => {
      if (this.activeSavePaths.get(key) === id) this.activeSavePaths.delete(key);
    };
  }
}
