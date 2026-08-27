import { message } from '@tauri-apps/plugin-dialog';
import { EditorState } from '@tiptap/pm/state';
import { get } from 'svelte/store';
import { chooseSavePath, fileName, readMarkdown, writeMarkdown } from '../files';
import { isImagePath } from '../images/imageTypes';
import { validateWorkspaceImagePath } from '../images/localImage';
import { sidebarActions, sidebarState } from '../sidebar/sidebarStore';
import { chooseWorkspace, pathName } from '../sidebar/workspace';
import { settingsStore } from '../settings/settingsStore';
import {
  isMarkdownTab,
  tabsState,
  type EditorTab,
  type MarkdownTab,
  type TabsState,
} from '../tabs/tabStore';
import type { EditorApi, EditorCommand, StoredSelection } from './editorTypes';
import { saveClipboardImage } from './imageImport';

type PersistedTab = {
  id: string;
  path: string | null;
  name: string;
  type?: 'markdown' | 'image';
  content?: string;
  savedContent?: string;
  dirty: boolean;
  missing: boolean;
  selection?: StoredSelection;
};

type PersistedSession = {
  tabs: PersistedTab[];
  activeId: string | null;
};

type DirtyAction = 'save' | 'discard' | 'cancel';

const SESSION_KEY = 'hypermd.editor.session.v1';

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

class DocumentManager {
  private editor: EditorApi | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private autoSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private autoSaveEnabled = false;
  private untitledIndex = 1;

  constructor() {
    settingsStore.subscribe((settings) => {
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
      name: this.untitledIndex === 1 ? 'Sem título.md' : `Sem título ${this.untitledIndex}.md`,
      type: 'markdown',
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
    if (!path.toLowerCase().endsWith('.md')) throw new Error('Tipo de arquivo não suportado.');

    const markdown = await readMarkdown(path);
    const state = this.editor.createState(markdown);
    const tab: EditorTab = {
      id: crypto.randomUUID(),
      path,
      name: fileName(path),
      type: 'markdown',
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
    if (duplicate) throw new Error('Esse arquivo já está aberto em outra aba.');

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
        throw new Error('Esse arquivo já está aberto em outra aba.');
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

  openFind(): boolean {
    if (!this.editor) return false;
    const snapshot = get(tabsState);
    const tab = snapshot.tabs.find((candidate) => candidate.id === snapshot.activeId);
    if (!tab || !isMarkdownTab(tab)) return false;
    this.editor.openFind();
    return true;
  }

  async pasteClipboardImage(blob: Blob, selection: StoredSelection): Promise<boolean> {
    if (!this.editor) return false;
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
      return this.editor.insertImage(imported.markdownSrc, 'image', selection);
    }

    tab.state = this.editor.insertImageIntoState(
      tab.state,
      imported.markdownSrc,
      'image',
      selection,
    );
    tab.dirty = !tab.state.doc.eq(tab.savedDoc);
    this.publish({ ...snapshot, tabs: [...snapshot.tabs] });
    return true;
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

  renamePath(oldPath: string, newPath: string, isDirectory: boolean): void {
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
  }

  private async confirmDirty(tab: MarkdownTab): Promise<DirtyAction> {
    if (!tab.dirty) return 'discard';
    const result = await message(`Deseja salvar as alterações em “${tab.name}”?`, {
      title: 'Alterações não salvas',
      kind: 'warning',
      buttons: { yes: 'Salvar', no: 'Não salvar', cancel: 'Cancelar' },
    });
    if (result === 'Yes' || result === 'Salvar') return 'save';
    if (result === 'No' || result === 'Não salvar') return 'discard';
    return 'cancel';
  }

  private restoreSession(): boolean {
    if (!this.editor) return false;
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return false;
      const session = JSON.parse(raw) as PersistedSession;
      if (!Array.isArray(session.tabs) || session.tabs.length === 0) return false;
      // A sessão protege rascunhos sem arquivo, mas não reabre recursos do workspace anterior.
      const restorableTabs = session.tabs.filter(
        (stored) => stored.path === null && stored.type !== 'image',
      );
      if (restorableTabs.length === 0) return false;
      const tabs = restorableTabs.flatMap((stored): EditorTab[] => {
        if (stored.type === 'image') {
          if (!stored.path || !isImagePath(stored.path)) return [];
          return [
            {
              id: stored.id || crypto.randomUUID(),
              path: stored.path,
              name: stored.name || fileName(stored.path),
              type: 'image',
              dirty: false,
              missing: Boolean(stored.missing),
            },
          ];
        }
        const state = this.editor!.createState(stored.content ?? '', stored.selection);
        const savedDoc = stored.dirty
          ? this.editor!.createState(stored.savedContent ?? '').doc
          : state.doc;
        return [
          {
            id: stored.id || crypto.randomUUID(),
            path: stored.path,
            name: stored.name || fileName(stored.path),
            type: 'markdown',
            state,
            savedDoc,
            dirty: Boolean(stored.dirty),
            missing: Boolean(stored.missing),
          },
        ];
      });
      if (tabs.length === 0) return false;
      const activeId = tabs.some((tab) => tab.id === session.activeId)
        ? session.activeId
        : tabs[0].id;
      tabs.forEach((tab) => {
        const match = tab.name.match(/^Sem título(?: (\d+))?\.md$/);
        if (match) this.untitledIndex = Math.max(this.untitledIndex, Number(match[1] ?? 1) + 1);
      });
      this.publish({ tabs, activeId, ready: true });
      const editorTab = tabs.find(
        (tab): tab is MarkdownTab => tab.id === activeId && isMarkdownTab(tab),
      );
      if (editorTab) {
        this.editor.setState(editorTab.state);
        this.editor.focus();
      }
      return true;
    } catch (error) {
      console.warn('Não foi possível restaurar a sessão', error);
      localStorage.removeItem(SESSION_KEY);
      return false;
    }
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
          console.warn(`Auto Save falhou para ${current.name}.`, error),
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
    const snapshot = get(tabsState);
    const session: PersistedSession = {
      activeId: snapshot.activeId,
      tabs: snapshot.tabs.flatMap((tab): PersistedTab[] => {
        if (tab.type === 'settings') return [];
        return isMarkdownTab(tab)
          ? [
              {
                id: tab.id,
                path: tab.path,
                name: tab.name,
                type: tab.type,
                content: this.editor!.serializeState(tab.state),
                savedContent: this.editor!.serializeNode(tab.savedDoc),
                dirty: tab.dirty,
                missing: tab.missing,
                selection: { anchor: tab.state.selection.anchor, head: tab.state.selection.head },
              },
            ]
          : [
              {
                id: tab.id,
                path: tab.path,
                name: tab.name,
                type: tab.type,
                dirty: false,
                missing: tab.missing,
              },
            ];
      }),
    };
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (error) {
      console.warn('Não foi possível persistir a sessão', error);
    }
  }
}

export const documentManager = new DocumentManager();
