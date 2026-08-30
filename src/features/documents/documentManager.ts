import { EditorState } from '@tiptap/pm/state';
import { get } from 'svelte/store';
import { fileName } from '@/platform/tauri/files';
import { dialogService } from '@/shared/ui/dialogs';
import { isImagePath } from '@/shared/utils/imageTypes';
import { isInsideWorkspace, sidebarState } from '@/features/workspace';
import {
  isMarkdownTab,
  tabsState,
  type EditorTab,
  type MarkdownTab,
  type TabsState,
} from './tabs/tabStore';
import type { EditorApi, EditorCommand, StoredSelection } from './editor/editorTypes';
import {
  DocumentImageService,
  type ImageReferenceOperationOptions,
  type ImageReferenceRenamePlan,
  type ImageReferenceWriteResult,
} from './documentImages';
import {
  activeMarkdownTab,
  flushDocumentSession,
  persistDocumentSession,
  restoreDocumentSession,
} from './documentSession';
import { AutoSaveCoordinator, type AutoSaveService } from './autoSaveCoordinator';
import { DocumentPersistence, type DocumentPersistenceService } from './documentPersistence';

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
  private untitledIndex = 1;
  private readonly autoSave: AutoSaveService;
  private readonly persistence: DocumentPersistenceService;
  private readonly imageService: DocumentImageService;

  constructor(autoSave?: AutoSaveService, persistence?: DocumentPersistenceService) {
    this.autoSave =
      autoSave ??
      new AutoSaveCoordinator({
        save: (id) => this.save(id),
        persistSession: () => this.persistNow(),
        flushSession: () => this.flushNow(),
      });
    this.persistence =
      persistence ??
      new DocumentPersistence({
        getEditor: () => this.editor,
        getTabs: () => get(tabsState),
        publish: (snapshot) => this.publish(snapshot),
        activate: (id) => this.activate(id),
        scheduleAutoSave: (tab) => this.autoSave.schedule(tab),
      });
    this.imageService = new DocumentImageService({
      getEditor: () => this.editor,
      publish: (snapshot) => this.publish(snapshot),
      scheduleAutoSave: (tab) => this.autoSave.schedule(tab),
    });
  }

  dispose(): void {
    this.autoSave.dispose();
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
    return this.persistence.open(path);
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
      this.autoSave.schedule(tab);
    } else {
      this.autoSave.scheduleSessionPersist();
    }
  }

  async save(id = get(tabsState).activeId, saveAs = false): Promise<boolean> {
    return this.persistence.save(id, saveAs);
  }

  async close(id = get(tabsState).activeId): Promise<boolean> {
    if (!id) return true;
    await this.persistence.waitForSave(id);
    const snapshot = get(tabsState);
    const index = snapshot.tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return true;
    const tab = snapshot.tabs[index];
    const action = isMarkdownTab(tab) ? await this.confirmDirty(tab) : 'discard';
    if (action === 'cancel') return false;
    if (action === 'save' && !(await this.save(tab.id))) return false;
    this.autoSave.clear(tab.id);

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
      await this.persistence.waitForSave(initialTab.id);
      const tab = get(tabsState).tabs.find((candidate) => candidate.id === initialTab.id);
      if (!tab || !isMarkdownTab(tab) || !tab.dirty) continue;
      const action = await this.confirmDirty(tab);
      if (action === 'cancel') return false;
      if (action === 'save' && !(await this.save(tab.id))) return false;
    }

    const snapshot = get(tabsState);
    if (!snapshot.tabs.some((tab) => workspaceTabIds.has(tab.id))) return true;
    for (const tab of snapshot.tabs) {
      if (workspaceTabIds.has(tab.id)) this.autoSave.clear(tab.id);
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
    const tabIds = get(tabsState).tabs.map((tab) => tab.id);
    for (const tabId of tabIds) {
      await this.persistence.waitForSave(tabId);
      const tab = get(tabsState).tabs.find((candidate) => candidate.id === tabId);
      if (!tab) continue;
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
    await this.flushSession();
    return true;
  }

  persistSession(): void {
    this.autoSave.persistSession();
  }

  async flushSession(): Promise<void> {
    await this.autoSave.flushSession();
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
        this.autoSave.clear(tab.id);
        changed = true;
      }
    }
    if (changed) this.publish({ ...snapshot, tabs: [...snapshot.tabs] });
  }

  async renamePath(oldPath: string, newPath: string, isDirectory: boolean): Promise<void> {
    this.renamePathOnly(oldPath, newPath, isDirectory);
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

  renamePathOnly(oldPath: string, newPath: string, isDirectory: boolean): void {
    const snapshot = get(tabsState);
    let changed = false;
    for (const tab of snapshot.tabs) {
      if (!pathMatches(tab.path, oldPath, isDirectory) || !tab.path) continue;
      const suffix = tab.path.slice(oldPath.length);
      tab.path = `${newPath}${suffix}`;
      tab.name = fileName(tab.path);
      tab.missing = false;
      this.autoSave.schedule(tab);
      changed = true;
    }
    if (changed) this.publish({ ...snapshot, tabs: [...snapshot.tabs] });
  }

  planWorkspaceImageRename(
    workspaceRoot: string,
    oldImagePath: string,
    newImagePath: string,
    options?: ImageReferenceOperationOptions,
  ): Promise<ImageReferenceRenamePlan> {
    return this.imageService.planWorkspaceImageReferenceRename(
      workspaceRoot,
      oldImagePath,
      newImagePath,
      options,
    );
  }

  writeWorkspaceImageRename(
    plan: ImageReferenceRenamePlan,
    options?: Pick<ImageReferenceOperationOptions, 'onProgress'>,
  ): Promise<ImageReferenceWriteResult> {
    return this.imageService.writeWorkspaceImageReferencePlan(plan, options);
  }

  reconcileWorkspaceImageRename(
    plan: ImageReferenceRenamePlan,
    documentsAtDestination: readonly string[],
  ): Promise<void> {
    return this.imageService.reconcileWorkspaceImageReferencePlan(plan, documentsAtDestination);
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
    this.autoSave.scheduleSessionPersist();
  }

  private persistNow(): void {
    if (!this.editor) return;
    persistDocumentSession(this.editor, get(tabsState));
  }

  private async flushNow(): Promise<void> {
    if (!this.editor) return;
    await flushDocumentSession(this.editor, get(tabsState));
  }
}

export const documentManager = new DocumentManager();
