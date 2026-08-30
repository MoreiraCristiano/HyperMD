import { chooseSavePath, fileName, readMarkdown, writeMarkdown } from '@/platform/tauri/files';
import { isImagePath } from '@/shared/utils/imageTypes';
import { validateWorkspaceImagePath } from './images/localImage';
import { isMarkdownTab, type EditorTab, type TabsState } from './tabs/tabStore';
import type { EditorApi } from './editor/editorTypes';

export interface DocumentPersistenceService {
  open(path: string): Promise<boolean>;
  save(id: string | null, saveAs?: boolean): Promise<boolean>;
  waitForSave(id: string): Promise<void>;
}

type DocumentPersistenceOptions = {
  getEditor: () => EditorApi | null;
  getTabs: () => TabsState;
  publish: (snapshot: TabsState) => void;
  activate: (id: string) => void;
  scheduleAutoSave: (tab: EditorTab) => void;
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

    const markdown = await readMarkdown(path);
    const state = editor.createState(markdown);
    const tab: EditorTab = {
      id: crypto.randomUUID(),
      path,
      name: fileName(path),
      type: 'markdown',
      pinned: false,
      state,
      savedDoc: state.doc,
      dirty: false,
      missing: false,
    };
    const snapshot = this.options.getTabs();
    this.options.publish({ ...snapshot, tabs: [...snapshot.tabs, tab], activeId: tab.id });
    editor.setState(state);
    editor.focus();
    return true;
  }

  async save(id: string | null, saveAs = false): Promise<boolean> {
    if (!this.options.getEditor() || !id) return false;
    const previous = this.saveQueues.get(id) ?? Promise.resolve();
    const operation = previous.then(() => this.performSave(id, saveAs));
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

  private async performSave(id: string, saveAs: boolean): Promise<boolean> {
    const editor = this.options.getEditor();
    if (!editor) return false;
    const snapshot = this.options.getTabs();
    const tab = snapshot.tabs.find((candidate) => candidate.id === id);
    if (!tab) return false;
    if (!isMarkdownTab(tab)) return true;
    if (snapshot.activeId === id) tab.state = editor.getState();

    let path = tab.path;
    if (!path || saveAs || tab.missing) path = await chooseSavePath(path ?? tab.name);
    if (!path) return false;
    const savedState = tab.state;
    const markdown = editor.serializeState(savedState);
    let releasePath = this.reserveSavePath(id, path);
    try {
      try {
        await writeMarkdown(path, markdown);
      } catch (cause) {
        releasePath();
        releasePath = () => {};
        if (saveAs || !tab.path) throw cause;
        const authorizedPath = await chooseSavePath(path);
        if (!authorizedPath) return false;
        path = authorizedPath;
        releasePath = this.reserveSavePath(id, path);
        await writeMarkdown(path, markdown);
      }
      tab.path = path;
      tab.name = fileName(path);
      tab.savedDoc = savedState.doc;
      tab.dirty = !tab.state.doc.eq(tab.savedDoc);
      tab.missing = false;
      this.options.publish({ ...snapshot, tabs: [...snapshot.tabs] });
      this.options.scheduleAutoSave(tab);
      return true;
    } finally {
      releasePath();
    }
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
