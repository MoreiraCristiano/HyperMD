import { EditorState } from '@tiptap/pm/state';
import { get } from 'svelte/store';
import { sidebarActions, sidebarState } from '@/features/workspace';
import { chooseWorkspace, listWorkspaceMarkdownFiles, pathName } from '@/features/workspace';
import { readMarkdown, writeMarkdown } from '@/platform/tauri/files';
import { dirname, normalize } from '@/platform/tauri/path';
import type { EditorApi, StoredSelection } from './documentTypes';
import { saveClipboardImage } from './editor/imageImport';
import { rewriteImageReferences } from './editor/imageReferences';
import { relativeMarkdownImagePath, validateWorkspaceImagePath } from './images/localImage';
import { isMarkdownTab, tabsState, type EditorTab, type TabsState } from './tabs/tabStore';

type DocumentImageServiceOptions = {
  getEditor: () => EditorApi | null;
  publish: (snapshot: TabsState) => void;
  scheduleAutoSave: (tab: EditorTab) => void;
};

function comparablePath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return /^[A-Za-z]:/.test(normalized) ? normalized.toLowerCase() : normalized;
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

  async updateWorkspaceImageReferences(
    workspaceRoot: string,
    oldImagePath: string,
    newImagePath: string,
  ): Promise<void> {
    const editor = this.options.getEditor();
    if (!editor) return;
    const markdownPaths = await listWorkspaceMarkdownFiles(workspaceRoot);
    for (const documentPath of markdownPaths) {
      const openTab = get(tabsState).tabs.find(
        (tab) =>
          isMarkdownTab(tab) &&
          tab.path !== null &&
          comparablePath(tab.path) === comparablePath(documentPath),
      );
      if (openTab && isMarkdownTab(openTab)) {
        await this.updateOpenImageReferences(openTab.id, documentPath, oldImagePath, newImagePath);
      } else {
        const state = editor.createState(await readMarkdown(documentPath));
        const rewritten = await rewriteImageReferences(
          state,
          documentPath,
          oldImagePath,
          newImagePath,
        );
        if (rewritten.changed) {
          await writeMarkdown(documentPath, editor.serializeState(rewritten.state));
        }
      }
    }
  }

  private async updateOpenImageReferences(
    tabId: string,
    documentPath: string,
    oldImagePath: string,
    newImagePath: string,
  ): Promise<void> {
    const editor = this.options.getEditor();
    if (!editor) return;

    while (true) {
      const snapshot = get(tabsState);
      const tab = snapshot.tabs.find((candidate) => candidate.id === tabId);
      if (
        !tab ||
        !isMarkdownTab(tab) ||
        !tab.path ||
        comparablePath(tab.path) !== comparablePath(documentPath)
      ) {
        return;
      }
      const originalState = tab.state;
      const rewritten = await rewriteImageReferences(
        originalState,
        documentPath,
        oldImagePath,
        newImagePath,
      );
      const latest = get(tabsState);
      const latestTab = latest.tabs.find((candidate) => candidate.id === tabId);
      if (
        !latestTab ||
        !isMarkdownTab(latestTab) ||
        !latestTab.path ||
        comparablePath(latestTab.path) !== comparablePath(documentPath)
      ) {
        return;
      }
      if (latestTab.state !== originalState) continue;
      if (rewritten.changed) {
        latestTab.state = rewritten.state;
        latestTab.dirty = !latestTab.state.doc.eq(latestTab.savedDoc);
        this.options.publish({ ...latest, tabs: [...latest.tabs] });
        if (latest.activeId === tabId) editor.setState(rewritten.state);
        this.options.scheduleAutoSave(latestTab);
      }
      break;
    }

    while (true) {
      const snapshot = get(tabsState);
      const tab = snapshot.tabs.find((candidate) => candidate.id === tabId);
      if (
        !tab ||
        !isMarkdownTab(tab) ||
        !tab.path ||
        comparablePath(tab.path) !== comparablePath(documentPath)
      ) {
        return;
      }
      const originalSavedDoc = tab.savedDoc;
      const savedState = EditorState.create({
        schema: tab.state.schema,
        doc: originalSavedDoc,
        plugins: tab.state.plugins,
      });
      const rewritten = await rewriteImageReferences(
        savedState,
        documentPath,
        oldImagePath,
        newImagePath,
      );
      if (!rewritten.changed) return;
      await writeMarkdown(documentPath, editor.serializeState(rewritten.state));
      const latest = get(tabsState);
      const latestTab = latest.tabs.find((candidate) => candidate.id === tabId);
      if (
        !latestTab ||
        !isMarkdownTab(latestTab) ||
        !latestTab.path ||
        comparablePath(latestTab.path) !== comparablePath(documentPath)
      ) {
        return;
      }
      if (latestTab.savedDoc !== originalSavedDoc) continue;
      latestTab.savedDoc = rewritten.state.doc;
      latestTab.dirty = !latestTab.state.doc.eq(latestTab.savedDoc);
      this.options.publish({ ...latest, tabs: [...latest.tabs] });
      this.options.scheduleAutoSave(latestTab);
      return;
    }
  }
}
