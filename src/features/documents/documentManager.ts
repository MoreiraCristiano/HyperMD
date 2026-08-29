import { EditorState } from '@tiptap/pm/state';
import { get } from 'svelte/store';
import { chooseSavePath, fileName, readMarkdown, writeMarkdown } from '@/platform/tauri/files';
import { dialogService } from '@/shared/ui/dialogs';
import { isImagePath } from '@/shared/utils/imageTypes';
import { isInsideWorkspace, sidebarState } from '@/features/workspace';
import { settingsStore } from '@/features/settings';
import {
  isMarkdownTab,
  tabsState,
  type EditorTab,
  type MarkdownTab,
  type TabsState,
} from './tabs/tabStore';
import type { EditorApi, EditorCommand, StoredSelection } from './editor/editorTypes';
import { DocumentImageService } from './documentImages';
import { validateWorkspaceImagePath } from './images/localImage';
import {
  activeMarkdownTab,
  persistDocumentSession,
  restoreDocumentSession,
} from './documentSession';

type DirtyAction = 'save' | 'discard' | 'cancel';

function comparablePath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return /^[A-Za-z]:/.test(normalized) ? normalized.toLowerCase() : normalized;
}

function pathMatches(path: string | null, target: string, directory: boolean): boolean {
  if (!path) return false;
  const candidate = comparablePath(path);
  const base = comparablePath(target).replace(/\/+$/, '');
  return candidate === base || (directory && candidate.startsWith(`${base}/`));
}

export class DocumentManager {
  private editor: EditorApi | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private autoSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private autoSaveEnabled = false;
  private untitledIndex = 1;
  private unsubscribeSettings: () => void;
  private readonly imageService = new DocumentImageService({
    getEditor: () => this.editor,
    publish: (snapshot) => this.publish(snapshot),
    scheduleAutoSave: (tab) => this.scheduleAutoSave(tab),
  });

  constructor() {
    this.unsubscribeSettings = settingsStore.subscribe((settings) => {
      const enabled = settings.files.autoSave;
      const wasEnabled = this.autoSaveEnabled;
      this.autoSaveEnabled = enabled;
      if (!enabled) {
        for (const timer of this.autoSaveTimers.values()) clearTimeout(timer);
        this.autoSaveTimers.clear();
      } else if (!wasEnabled) {
        for (const tab of get(tabsState).tabs) this.scheduleAutoSave(tab);
      }
    });
  }

  dispose(): void {
    clearTimeout(this.persistTimer);
    for (const timer of this.autoSaveTimers.values()) clearTimeout(timer);
    this.autoSaveTimers.clear();
    this.unsubscribeSettings();
    this.editor = null;
  }

  attachEditor(editor: EditorApi): void {
    this.editor = editor;
    if (!this.restoreSession()) this.newDocument();
    else this.publish({ ...get(tabsState), ready: true });
  }

  newDocument(): string | null {
    if (!this.editor) return null;
    const state = this.editor.createState('');
    const tab: EditorTab = {
      id: crypto.randomUUID(),
      path: null,
      name: this.untitledIndex === 1 ? 'Untitled.md' : `Untitled ${this.untitledIndex}.md`,
      type: 'markdown',
      pinned: false,
      state,
      savedDoc: state.doc,
      dirty: false,
      missing: false,
    };
    this.untitledIndex += 1;
    const snapshot = get(tabsState);
    this.publish({ tabs: [...snapshot.tabs, tab], activeId: tab.id, ready: true });
    this.editor.setState(state);
    this.editor.focus();
    return tab.id;
  }

  openSettings(): string | null {
    if (!this.editor) return null;
    const snapshot = get(tabsState);
    const existing = snapshot.tabs.find((tab) => tab.type === 'settings');
    if (existing) {
      this.activate(existing.id);
      return existing.id;
    }
    const tab: EditorTab = {
      id: 'hypermd:settings',
      path: null,
      name: 'Settings',
      type: 'settings',
      pinned: false,
      dirty: false,
      missing: false,
    };
    this.publish({ ...snapshot, tabs: [...snapshot.tabs, tab], activeId: tab.id });
    return tab.id;
  }

  openShortcuts(): string | null {
    if (!this.editor) return null;
    const snapshot = get(tabsState);
    const existing = snapshot.tabs.find((tab) => tab.type === 'shortcuts');
    if (existing) {
      this.activate(existing.id);
      return existing.id;
    }
    const tab: EditorTab = {
      id: 'hypermd:keyboard-shortcuts',
      path: null,
      name: 'Keyboard Shortcuts',
      type: 'shortcuts',
      pinned: false,
      dirty: false,
      missing: false,
    };
    this.publish({ ...snapshot, tabs: [...snapshot.tabs, tab], activeId: tab.id });
    return tab.id;
  }

  async open(path: string): Promise<boolean> {
    if (!this.editor) return false;
    const existing = get(tabsState).tabs.find(
      (tab) => tab.path && comparablePath(tab.path) === comparablePath(path),
    );
    if (existing) {
      this.activate(existing.id);
      return true;
    }

    if (isImagePath(path)) return this.openImage(path);
    if (!path.toLowerCase().endsWith('.md')) throw new Error('Unsupported file type.');

    const markdown = await readMarkdown(path);
    const state = this.editor.createState(markdown);
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
    const snapshot = get(tabsState);
    this.publish({ ...snapshot, tabs: [...snapshot.tabs, tab], activeId: tab.id });
    this.editor.setState(state);
    this.editor.focus();
    return true;
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
    const snapshot = get(tabsState);
    this.publish({ ...snapshot, tabs: [...snapshot.tabs, tab], activeId: tab.id });
    return true;
  }

  activate(id: string): void {
    if (!this.editor) return;
    const snapshot = get(tabsState);
    const tab = snapshot.tabs.find((candidate) => candidate.id === id);
    if (!tab || snapshot.activeId === id) {
      if (tab && isMarkdownTab(tab)) this.editor.focus();
      return;
    }
    this.publish({ ...snapshot, activeId: id });
    if (isMarkdownTab(tab)) {
      this.editor.setState(tab.state);
      this.editor.focus();
    }
  }

  reorderTab(id: string, targetId: string, position: 'before' | 'after'): boolean {
    if (id === targetId) return false;
    const snapshot = get(tabsState);
    const source = snapshot.tabs.find((tab) => tab.id === id);
    const target = snapshot.tabs.find((tab) => tab.id === targetId);
    if (!source || !target || source.pinned !== target.pinned) return false;

    const tabs = snapshot.tabs.filter((tab) => tab.id !== id);
    const targetIndex = tabs.findIndex((tab) => tab.id === targetId);
    if (targetIndex === -1) return false;
    tabs.splice(targetIndex + (position === 'after' ? 1 : 0), 0, source);
    this.publish({ ...snapshot, tabs });
    return true;
  }

  moveTabToGroupEnd(id: string): boolean {
    const snapshot = get(tabsState);
    const source = snapshot.tabs.find((tab) => tab.id === id);
    if (!source) return false;
    const tabs = snapshot.tabs.filter((tab) => tab.id !== id);
    const insertionIndex = source.pinned ? tabs.findIndex((tab) => !tab.pinned) : tabs.length;
    tabs.splice(insertionIndex === -1 ? tabs.length : insertionIndex, 0, source);
    this.publish({ ...snapshot, tabs });
    return true;
  }

  setTabPinned(id: string, pinned: boolean): boolean {
    const snapshot = get(tabsState);
    const source = snapshot.tabs.find((tab) => tab.id === id);
    if (!source || source.pinned === pinned) return false;
    const tabs = snapshot.tabs.filter((tab) => tab.id !== id);
    source.pinned = pinned;
    const firstUnpinned = tabs.findIndex((tab) => !tab.pinned);
    const insertionIndex = firstUnpinned === -1 ? tabs.length : firstUnpinned;
    tabs.splice(insertionIndex, 0, source);
    this.publish({ ...snapshot, tabs });
    return true;
  }

  handleTransaction(state: EditorState, docChanged: boolean): void {
    const snapshot = get(tabsState);
    const tab = snapshot.tabs.find((candidate) => candidate.id === snapshot.activeId);
    if (!tab || !isMarkdownTab(tab)) return;
    tab.state = state;
    if (docChanged) {
      tab.dirty = !state.doc.eq(tab.savedDoc);
      this.publish({ ...snapshot, tabs: [...snapshot.tabs] });
      this.scheduleAutoSave(tab);
    } else {
      this.schedulePersist();
    }
  }

  async save(id = get(tabsState).activeId, saveAs = false): Promise<boolean> {
    if (!this.editor || !id) return false;
    const snapshot = get(tabsState);
    const tab = snapshot.tabs.find((candidate) => candidate.id === id);
    if (!tab) return false;
    if (!isMarkdownTab(tab)) return true;
    if (snapshot.activeId === id) tab.state = this.editor.getState();

    let path = tab.path;
    if (!path || saveAs || tab.missing) path = await chooseSavePath(path ?? tab.name);
    if (!path) return false;
    const duplicate = snapshot.tabs.find(
      (candidate) =>
        candidate.id !== id &&
        candidate.path &&
        comparablePath(candidate.path) === comparablePath(path!),
    );
    if (duplicate) throw new Error('This file is already open in another tab.');

    const savedState = tab.state;
    const markdown = this.editor.serializeState(savedState);
    try {
      await writeMarkdown(path, markdown);
    } catch (cause) {
      if (saveAs || !tab.path) throw cause;
      const authorizedPath = await chooseSavePath(path);
      if (!authorizedPath) return false;
      if (
        snapshot.tabs.some(
          (candidate) =>
            candidate.id !== id &&
            candidate.path &&
            comparablePath(candidate.path) === comparablePath(authorizedPath),
        )
      ) {
        throw new Error('This file is already open in another tab.');
      }
      path = authorizedPath;
      await writeMarkdown(path, markdown);
    }
    tab.path = path;
    tab.name = fileName(path);
    tab.savedDoc = savedState.doc;
    tab.dirty = !tab.state.doc.eq(tab.savedDoc);
    tab.missing = false;
    this.publish({ ...snapshot, tabs: [...snapshot.tabs] });
    this.scheduleAutoSave(tab);
    return true;
  }

  async close(id = get(tabsState).activeId): Promise<boolean> {
    if (!id) return true;
    const snapshot = get(tabsState);
    const index = snapshot.tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return true;
    const tab = snapshot.tabs[index];
    const action = isMarkdownTab(tab) ? await this.confirmDirty(tab) : 'discard';
    if (action === 'cancel') return false;
    if (action === 'save' && !(await this.save(tab.id))) return false;
    this.clearAutoSave(tab.id);

    const tabs = snapshot.tabs.filter((candidate) => candidate.id !== id);
    let activeId = snapshot.activeId;
    if (activeId === id) activeId = tabs[Math.min(index, tabs.length - 1)]?.id ?? null;
    this.publish({ ...snapshot, tabs, activeId });
    if (activeId && this.editor) {
      const active = tabs.find((candidate) => candidate.id === activeId)!;
      if (isMarkdownTab(active)) {
        this.editor.setState(active.state);
        this.editor.focus();
      }
    } else if (this.editor) {
      this.editor.setState(this.editor.createState(''));
    }
    return true;
  }

  async closeWorkspaceTabs(workspacePath: string): Promise<boolean> {
    const initial = get(tabsState);
    const workspaceTabs = initial.tabs.filter((tab) => pathMatches(tab.path, workspacePath, true));
    const workspaceTabIds = new Set(workspaceTabs.map((tab) => tab.id));

    for (const initialTab of workspaceTabs) {
      const tab = get(tabsState).tabs.find((candidate) => candidate.id === initialTab.id);
      if (!tab || !isMarkdownTab(tab) || !tab.dirty) continue;
      const action = await this.confirmDirty(tab);
      if (action === 'cancel') return false;
      if (action === 'save' && !(await this.save(tab.id))) return false;
    }

    const snapshot = get(tabsState);
    if (!snapshot.tabs.some((tab) => workspaceTabIds.has(tab.id))) return true;
    for (const tab of snapshot.tabs) {
      if (workspaceTabIds.has(tab.id)) this.clearAutoSave(tab.id);
    }

    const tabs = snapshot.tabs.filter((tab) => !workspaceTabIds.has(tab.id));
    let activeId = snapshot.activeId;
    if (activeId && workspaceTabIds.has(activeId)) {
      const activeIndex = snapshot.tabs.findIndex((tab) => tab.id === activeId);
      const nextTab = snapshot.tabs
        .slice(activeIndex + 1)
        .find((tab) => !workspaceTabIds.has(tab.id));
      const previousTab = snapshot.tabs
        .slice(0, activeIndex)
        .reverse()
        .find((tab) => !workspaceTabIds.has(tab.id));
      activeId = nextTab?.id ?? previousTab?.id ?? null;
    }

    this.publish({ ...snapshot, tabs, activeId });
    const active = tabs.find((tab) => tab.id === activeId);
    if (active && this.editor && isMarkdownTab(active)) {
      this.editor.setState(active.state);
      this.editor.focus();
    } else if (!active && this.editor) {
      this.editor.setState(this.editor.createState(''));
    }
    return true;
  }

  activateRelative(offset: number): void {
    const snapshot = get(tabsState);
    if (snapshot.tabs.length < 2 || !snapshot.activeId) return;
    const index = snapshot.tabs.findIndex((tab) => tab.id === snapshot.activeId);
    const next = (index + offset + snapshot.tabs.length) % snapshot.tabs.length;
    this.activate(snapshot.tabs[next].id);
  }

  activatePosition(position: number): void {
    const tab = get(tabsState).tabs[position];
    if (tab) this.activate(tab.id);
  }

  async prepareWindowClose(): Promise<boolean> {
    const snapshot = get(tabsState);
    for (const tab of snapshot.tabs) {
      if (!isMarkdownTab(tab) || !tab.dirty) continue;
      const action = await this.confirmDirty(tab);
      if (action === 'cancel') return false;
      if (action === 'save' && !(await this.save(tab.id))) return false;
      if (action === 'discard') {
        tab.state = EditorState.create({
          schema: tab.state.schema,
          doc: tab.savedDoc,
          plugins: tab.state.plugins,
        });
        tab.dirty = false;
      }
    }
    this.persistNow();
    return true;
  }

  persistSession(): void {
    this.persistNow();
  }

  async execute(command: EditorCommand): Promise<boolean> {
    if (!this.editor) return false;
    const snapshot = get(tabsState);
    const tab = snapshot.tabs.find((candidate) => candidate.id === snapshot.activeId);
    if (!tab || !isMarkdownTab(tab)) return false;
    return this.editor.execute(command);
  }

  canInsertTable(): boolean {
    if (!this.editor) return false;
    const snapshot = get(tabsState);
    const tab = snapshot.tabs.find((candidate) => candidate.id === snapshot.activeId);
    return Boolean(tab && isMarkdownTab(tab) && this.editor.canInsertTable());
  }

  insertTable(rows: number, columns: number): boolean {
    if (!this.canInsertTable() || !this.editor) return false;
    return this.editor.insertTable(rows, columns);
  }

  openFind(): boolean {
    if (!this.editor) return false;
    const snapshot = get(tabsState);
    const tab = snapshot.tabs.find((candidate) => candidate.id === snapshot.activeId);
    if (!tab || !isMarkdownTab(tab)) return false;
    this.editor.openFind();
    return true;
  }

  async pasteClipboardImage(blob: Blob, selection: StoredSelection): Promise<boolean> {
    return this.imageService.pasteClipboardImage(blob, selection);
  }

  async insertWorkspaceImage(path: string, selection: StoredSelection): Promise<boolean> {
    return this.imageService.insertWorkspaceImage(path, selection);
  }

  markMissing(path: string, isDirectory: boolean): void {
    const snapshot = get(tabsState);
    let changed = false;
    for (const tab of snapshot.tabs) {
      if (pathMatches(tab.path, path, isDirectory)) {
        tab.missing = true;
        this.clearAutoSave(tab.id);
        changed = true;
      }
    }
    if (changed) this.publish({ ...snapshot, tabs: [...snapshot.tabs] });
  }

  async renamePath(oldPath: string, newPath: string, isDirectory: boolean): Promise<void> {
    const snapshot = get(tabsState);
    let changed = false;
    for (const tab of snapshot.tabs) {
      if (!pathMatches(tab.path, oldPath, isDirectory) || !tab.path) continue;
      const suffix = tab.path.slice(oldPath.length);
      tab.path = `${newPath}${suffix}`;
      tab.name = fileName(tab.path);
      tab.missing = false;
      this.scheduleAutoSave(tab);
      changed = true;
    }
    if (changed) this.publish({ ...snapshot, tabs: [...snapshot.tabs] });
    const workspaceRoot = get(sidebarState).workspacePath;
    if (
      workspaceRoot &&
      !isDirectory &&
      isImagePath(oldPath) &&
      isImagePath(newPath) &&
      isInsideWorkspace(workspaceRoot, oldPath) &&
      isInsideWorkspace(workspaceRoot, newPath)
    ) {
      await this.imageService.updateWorkspaceImageReferences(workspaceRoot, oldPath, newPath);
    }
  }

  private async confirmDirty(tab: MarkdownTab): Promise<DirtyAction> {
    if (!tab.dirty) return 'discard';
    const result = await dialogService.choose({
      title: 'Unsaved Changes',
      message: `Do you want to save the changes to “${tab.name}”?`,
      tone: 'warning',
      actions: [
        { id: 'cancel', label: 'Cancel', variant: 'secondary' },
        { id: 'discard', label: "Don't Save", variant: 'secondary' },
        { id: 'save', label: 'Save', variant: 'primary' },
      ],
    });
    if (result === 'save') return 'save';
    if (result === 'discard') return 'discard';
    return 'cancel';
  }

  private restoreSession(): boolean {
    if (!this.editor) return false;
    const session = restoreDocumentSession(this.editor);
    if (!session) return false;
    this.untitledIndex = session.nextUntitledIndex;
    this.publish({ tabs: session.tabs, activeId: session.activeId, ready: true });
    const editorTab = activeMarkdownTab(session);
    if (editorTab) {
      this.editor.setState(editorTab.state);
      this.editor.focus();
    }
    return true;
  }

  private publish(snapshot: TabsState): void {
    tabsState.set(snapshot);
    this.schedulePersist();
  }

  private clearAutoSave(id: string): void {
    const timer = this.autoSaveTimers.get(id);
    if (timer) clearTimeout(timer);
    this.autoSaveTimers.delete(id);
  }

  private scheduleAutoSave(tab: EditorTab): void {
    this.clearAutoSave(tab.id);
    if (!this.autoSaveEnabled || !isMarkdownTab(tab) || !tab.dirty || !tab.path || tab.missing) {
      return;
    }
    this.autoSaveTimers.set(
      tab.id,
      setTimeout(() => {
        this.autoSaveTimers.delete(tab.id);
        const current = get(tabsState).tabs.find((candidate) => candidate.id === tab.id);
        if (!current || !isMarkdownTab(current) || !current.dirty || !current.path) return;
        void this.save(current.id).catch((error) =>
          console.warn(`Auto Save failed for ${current.name}.`, error),
        );
      }, 1000),
    );
  }

  private schedulePersist(): void {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.persistNow(), 800);
  }

  private persistNow(): void {
    if (!this.editor) return;
    persistDocumentSession(this.editor, get(tabsState));
  }
}

export const documentManager = new DocumentManager();
