import type { EditorState } from '@tiptap/pm/state';
import { get } from 'svelte/store';
import { fileName } from '@/platform/tauri/files';
import { isImagePath } from '@/shared/utils/imageTypes';
import { isInsideWorkspace, sidebarState } from '@/features/workspace';
import { isMarkdownTab, tabsState, type EditorTab, type TabsState } from './tabs/tabStore';
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
import { DirtyDocumentGuard, type DirtyDocumentGuardService } from './dirtyDocumentGuard';
import { documentNoticeActions } from './documentNotice';

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
  private readonly dirtyGuard: DirtyDocumentGuardService;
  private readonly imageService: DocumentImageService;

  constructor(
    autoSave?: AutoSaveService,
    persistence?: DocumentPersistenceService,
    dirtyGuard?: DirtyDocumentGuardService,
  ) {
    this.autoSave =
      autoSave ??
      new AutoSaveCoordinator({
        save: (id) => this.save(id, false, 'auto'),
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
        reportWarning: (message) => documentNoticeActions.show(message),
      });
    this.dirtyGuard =
      dirtyGuard ??
      new DirtyDocumentGuard({
        getEditor: () => this.editor,
        getTabs: () => get(tabsState),
        publish: (snapshot) => this.publish(snapshot),
        save: (id) => this.save(id),
        waitForSave: (id) => this.persistence.waitForSave(id),
        clearAutoSave: (id) => this.autoSave.clear(id),
        flushSession: () => this.flushSession(),
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
      sourceSnapshot: { source: '', canonical: '' },
      dirty: false,
      missing: false,
      diskRevision: null,
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

  async save(
    id = get(tabsState).activeId,
    saveAs = false,
    source: 'manual' | 'auto' = 'manual',
  ): Promise<boolean> {
    return this.persistence.save(id, saveAs, source);
  }

  async close(id = get(tabsState).activeId): Promise<boolean> {
    return this.dirtyGuard.close(id);
  }

  async closeWorkspaceTabs(workspacePath: string): Promise<boolean> {
    return this.dirtyGuard.closeWorkspaceTabs(workspacePath);
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
    return this.dirtyGuard.prepareWindowClose();
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
