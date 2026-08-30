import { EditorState } from '@tiptap/pm/state';
import { dialogService } from '@/shared/ui/dialogs';
import { isMarkdownTab, type MarkdownTab, type TabsState } from './tabs/tabStore';
import type { EditorApi } from './editor/editorTypes';

type DirtyAction = 'save' | 'discard' | 'cancel';

export interface DirtyDocumentGuardService {
  close(id: string | null): Promise<boolean>;
  closeWorkspaceTabs(workspacePath: string): Promise<boolean>;
  prepareWindowClose(): Promise<boolean>;
}

type DirtyDocumentGuardOptions = {
  getEditor: () => EditorApi | null;
  getTabs: () => TabsState;
  publish: (snapshot: TabsState) => void;
  save: (id: string) => Promise<boolean>;
  waitForSave: (id: string) => Promise<void>;
  clearAutoSave: (id: string) => void;
  flushSession: () => Promise<void>;
};

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

export class DirtyDocumentGuard implements DirtyDocumentGuardService {
  constructor(private readonly options: DirtyDocumentGuardOptions) {}

  async close(id: string | null): Promise<boolean> {
    if (!id) return true;
    await this.options.waitForSave(id);
    const snapshot = this.options.getTabs();
    const index = snapshot.tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return true;
    const tab = snapshot.tabs[index];
    const action = isMarkdownTab(tab) ? await this.confirmDirty(tab) : 'discard';
    if (action === 'cancel') return false;
    if (action === 'save' && !(await this.options.save(tab.id))) return false;
    this.options.clearAutoSave(tab.id);

    const tabs = snapshot.tabs.filter((candidate) => candidate.id !== id);
    let activeId = snapshot.activeId;
    if (activeId === id) activeId = tabs[Math.min(index, tabs.length - 1)]?.id ?? null;
    this.options.publish({ ...snapshot, tabs, activeId });
    const editor = this.options.getEditor();
    if (activeId && editor) {
      const active = tabs.find((candidate) => candidate.id === activeId)!;
      if (isMarkdownTab(active)) {
        editor.setState(active.state);
        editor.focus();
      }
    } else if (editor) {
      editor.setState(editor.createState(''));
    }
    return true;
  }

  async closeWorkspaceTabs(workspacePath: string): Promise<boolean> {
    const initial = this.options.getTabs();
    const workspaceTabs = initial.tabs.filter((tab) => pathMatches(tab.path, workspacePath, true));
    const workspaceTabIds = new Set(workspaceTabs.map((tab) => tab.id));

    for (const initialTab of workspaceTabs) {
      await this.options.waitForSave(initialTab.id);
      const tab = this.options.getTabs().tabs.find((candidate) => candidate.id === initialTab.id);
      if (!tab || !isMarkdownTab(tab) || !tab.dirty) continue;
      const action = await this.confirmDirty(tab);
      if (action === 'cancel') return false;
      if (action === 'save' && !(await this.options.save(tab.id))) return false;
    }

    const snapshot = this.options.getTabs();
    if (!snapshot.tabs.some((tab) => workspaceTabIds.has(tab.id))) return true;
    for (const tab of snapshot.tabs) {
      if (workspaceTabIds.has(tab.id)) this.options.clearAutoSave(tab.id);
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

    this.options.publish({ ...snapshot, tabs, activeId });
    const editor = this.options.getEditor();
    const active = tabs.find((tab) => tab.id === activeId);
    if (active && editor && isMarkdownTab(active)) {
      editor.setState(active.state);
      editor.focus();
    } else if (!active && editor) {
      editor.setState(editor.createState(''));
    }
    return true;
  }

  async prepareWindowClose(): Promise<boolean> {
    const tabIds = this.options.getTabs().tabs.map((tab) => tab.id);
    for (const tabId of tabIds) {
      await this.options.waitForSave(tabId);
      const tab = this.options.getTabs().tabs.find((candidate) => candidate.id === tabId);
      if (!tab || !isMarkdownTab(tab) || !tab.dirty) continue;
      const action = await this.confirmDirty(tab);
      if (action === 'cancel') return false;
      if (action === 'save' && !(await this.options.save(tab.id))) return false;
      if (action === 'discard') {
        tab.state = EditorState.create({
          schema: tab.state.schema,
          doc: tab.savedDoc,
          plugins: tab.state.plugins,
        });
        tab.dirty = false;
      }
    }
    await this.options.flushSession();
    return true;
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
}
