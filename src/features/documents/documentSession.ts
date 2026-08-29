import { fileName } from '@/platform/tauri/files';
import { isImagePath } from '@/shared/utils/imageTypes';
import type { EditorApi, StoredSelection } from './editor/editorTypes';
import { isMarkdownTab, type EditorTab, type MarkdownTab, type TabsState } from './tabs/tabStore';

type PersistedTab = {
  id: string;
  path: string | null;
  name: string;
  type?: 'markdown' | 'image';
  pinned?: boolean;
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

export type RestoredDocumentSession = TabsState & { nextUntitledIndex: number };

export const DOCUMENT_SESSION_KEY = 'hypermd.editor.session.v1';

function translateLegacyUntitledName(name: string | undefined): string {
  const legacy = name?.match(/^Sem título(?: (\d+))?\.md$/);
  if (!legacy) return name || 'Untitled.md';
  return legacy[1] ? `Untitled ${legacy[1]}.md` : 'Untitled.md';
}

export function restoreDocumentSession(editor: EditorApi): RestoredDocumentSession | null {
  try {
    const raw = localStorage.getItem(DOCUMENT_SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as PersistedSession;
    if (!Array.isArray(session.tabs) || session.tabs.length === 0) return null;

    const restorableTabs = session.tabs.filter(
      (stored) => stored.path === null && stored.type !== 'image',
    );
    if (restorableTabs.length === 0) return null;

    const tabs = restorableTabs.flatMap((stored): EditorTab[] => {
      if (stored.type === 'image') {
        if (!stored.path || !isImagePath(stored.path)) return [];
        return [
          {
            id: stored.id || crypto.randomUUID(),
            path: stored.path,
            name: stored.name || fileName(stored.path),
            type: 'image',
            pinned: Boolean(stored.pinned),
            dirty: false,
            missing: Boolean(stored.missing),
          },
        ];
      }
      const state = editor.createState(stored.content ?? '', stored.selection);
      const savedDoc = stored.dirty ? editor.createState(stored.savedContent ?? '').doc : state.doc;
      return [
        {
          id: stored.id || crypto.randomUUID(),
          path: stored.path,
          name:
            stored.path === null
              ? translateLegacyUntitledName(stored.name)
              : stored.name || fileName(stored.path),
          type: 'markdown',
          pinned: Boolean(stored.pinned),
          state,
          savedDoc,
          dirty: Boolean(stored.dirty),
          missing: Boolean(stored.missing),
        },
      ];
    });
    if (tabs.length === 0) return null;

    tabs.sort((left, right) => Number(right.pinned) - Number(left.pinned));
    const activeId = tabs.some((tab) => tab.id === session.activeId)
      ? session.activeId
      : tabs[0].id;
    const nextUntitledIndex = tabs.reduce((next, tab) => {
      const match = tab.name.match(/^Untitled(?: (\d+))?\.md$/);
      return match ? Math.max(next, Number(match[1] ?? 1) + 1) : next;
    }, 1);

    return { tabs, activeId, ready: true, nextUntitledIndex };
  } catch (error) {
    console.warn('Could not restore the session.', error);
    localStorage.removeItem(DOCUMENT_SESSION_KEY);
    return null;
  }
}

export function persistDocumentSession(editor: EditorApi, snapshot: TabsState): void {
  const session: PersistedSession = {
    activeId: snapshot.activeId,
    tabs: snapshot.tabs.flatMap((tab): PersistedTab[] => {
      if (tab.type === 'settings' || tab.type === 'shortcuts') return [];
      return isMarkdownTab(tab)
        ? [
            {
              id: tab.id,
              path: tab.path,
              name: tab.name,
              type: tab.type,
              pinned: tab.pinned,
              content: editor.serializeState(tab.state),
              savedContent: editor.serializeNode(tab.savedDoc),
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
              pinned: tab.pinned,
              dirty: false,
              missing: tab.missing,
            },
          ];
    }),
  };
  try {
    localStorage.setItem(DOCUMENT_SESSION_KEY, JSON.stringify(session));
  } catch (error) {
    console.warn('Could not persist the session.', error);
  }
}

export function activeMarkdownTab(session: RestoredDocumentSession): MarkdownTab | undefined {
  return session.tabs.find(
    (tab): tab is MarkdownTab => tab.id === session.activeId && isMarkdownTab(tab),
  );
}
