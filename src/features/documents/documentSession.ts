import type { EditorApi, StoredSelection } from './editor/editorTypes';
import { isMarkdownTab, type EditorTab, type MarkdownTab, type TabsState } from './tabs/tabStore';
import {
  readPersistedDocumentSession,
  writePersistedDocumentSession,
} from './documentSessionPersistence';

type PersistedDocumentV2 = {
  id: string;
  path: string | null;
  name: string;
  pinned: boolean;
  content: string;
  savedContent: string;
  dirty: boolean;
  missing: boolean;
  selection?: StoredSelection;
  diskRevision?: string | null;
  sourceContent?: string;
  baselineContent?: string;
};

type PersistedSessionV2 = {
  version: 2;
  documents: PersistedDocumentV2[];
  activeId: string | null;
};

type LegacyPersistedTab = {
  id?: unknown;
  path?: unknown;
  name?: unknown;
  type?: unknown;
  pinned?: unknown;
  content?: unknown;
  savedContent?: unknown;
  dirty?: unknown;
  missing?: unknown;
  selection?: unknown;
};

export type RestoredDocumentSession = TabsState & { nextUntitledIndex: number };

export const DOCUMENT_SESSION_KEY = 'hypermd.editor.session.v1';

let loadedSession: unknown | null | undefined;
let persistChain: Promise<void> = Promise.resolve();

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function storedSelection(value: unknown): StoredSelection | undefined {
  const candidate = record(value);
  if (
    !candidate ||
    typeof candidate.anchor !== 'number' ||
    !Number.isFinite(candidate.anchor) ||
    typeof candidate.head !== 'number' ||
    !Number.isFinite(candidate.head)
  ) {
    return undefined;
  }
  return { anchor: candidate.anchor, head: candidate.head };
}

function pathName(path: string): string {
  return path.split(/[\\/]/).pop() || 'Untitled.md';
}

function translateLegacyUntitledName(name: string | undefined): string {
  const legacy = name?.match(/^Sem título(?: (\d+))?\.md$/);
  if (!legacy) return name || 'Untitled.md';
  return legacy[1] ? `Untitled ${legacy[1]}.md` : 'Untitled.md';
}

function normalizeDocument(value: unknown): PersistedDocumentV2 | null {
  const stored = record(value);
  if (!stored || typeof stored.id !== 'string') return null;
  if (stored.path !== null && typeof stored.path !== 'string') return null;
  if (typeof stored.name !== 'string' || typeof stored.content !== 'string') return null;
  if (typeof stored.savedContent !== 'string' || typeof stored.dirty !== 'boolean') return null;
  return {
    id: stored.id,
    path: stored.path,
    name: stored.name,
    pinned: stored.pinned === true,
    content: stored.content,
    savedContent: stored.savedContent,
    dirty: stored.dirty,
    missing: stored.missing === true,
    selection: storedSelection(stored.selection),
    diskRevision: typeof stored.diskRevision === 'string' ? stored.diskRevision : null,
    sourceContent: typeof stored.sourceContent === 'string' ? stored.sourceContent : undefined,
    baselineContent:
      typeof stored.baselineContent === 'string' ? stored.baselineContent : undefined,
  };
}

function normalizeSession(value: unknown): PersistedSessionV2 | null {
  const stored = record(value);
  if (!stored || stored.version !== 2 || !Array.isArray(stored.documents)) return null;
  const documents = stored.documents.flatMap((document) => {
    const normalized = normalizeDocument(document);
    return normalized ? [normalized] : [];
  });
  return {
    version: 2,
    documents,
    activeId: typeof stored.activeId === 'string' ? stored.activeId : null,
  };
}

function readLegacySession(): unknown | null {
  const raw = localStorage.getItem(DOCUMENT_SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn('Could not read the legacy document session.', error);
    return null;
  }
}

function migrateLegacySession(value: unknown): PersistedSessionV2 | null {
  const legacy = record(value);
  if (!legacy || !Array.isArray(legacy.tabs)) return null;
  const documents = legacy.tabs.flatMap((value): PersistedDocumentV2[] => {
    const stored = value as LegacyPersistedTab;
    if (stored.type === 'image' || (stored.type !== undefined && stored.type !== 'markdown')) {
      return [];
    }
    const path = stored.path === null || typeof stored.path === 'string' ? stored.path : null;
    const dirty = stored.dirty === true;
    if (path !== null && !dirty) return [];
    const content = typeof stored.content === 'string' ? stored.content : '';
    const name =
      path === null
        ? translateLegacyUntitledName(typeof stored.name === 'string' ? stored.name : undefined)
        : typeof stored.name === 'string'
          ? stored.name
          : pathName(path);
    return [
      {
        id: typeof stored.id === 'string' && stored.id ? stored.id : crypto.randomUUID(),
        path,
        name,
        pinned: stored.pinned === true,
        content,
        savedContent: typeof stored.savedContent === 'string' ? stored.savedContent : content,
        dirty,
        missing: stored.missing === true,
        selection: storedSelection(stored.selection),
        diskRevision: null,
      },
    ];
  });
  const activeId =
    typeof legacy.activeId === 'string' &&
    documents.some((document) => document.id === legacy.activeId)
      ? legacy.activeId
      : null;
  return { version: 2, documents, activeId };
}

export async function initializeDocumentSession(): Promise<void> {
  if (loadedSession !== undefined) return;
  const persisted = await readPersistedDocumentSession();
  if (persisted !== null) {
    loadedSession = persisted;
    return;
  }

  const migrated = migrateLegacySession(readLegacySession());
  loadedSession = migrated;
  if (!migrated) return;
  try {
    await writePersistedDocumentSession(migrated);
  } catch (error) {
    console.warn('Could not migrate the legacy document session.', error);
  }
}

export function restoreDocumentSession(editor: EditorApi): RestoredDocumentSession | null {
  try {
    const source =
      loadedSession === undefined ? migrateLegacySession(readLegacySession()) : loadedSession;
    const session = normalizeSession(source);
    if (!session || session.documents.length === 0) return null;

    const tabs = session.documents.flatMap((stored): EditorTab[] => {
      try {
        const state = editor.createState(stored.content, stored.selection);
        const savedDoc = stored.dirty ? editor.createState(stored.savedContent).doc : state.doc;
        const savedCanonical = editor.serializeNode(savedDoc);
        return [
          {
            id: stored.id || crypto.randomUUID(),
            path: stored.path,
            name: stored.path === null ? translateLegacyUntitledName(stored.name) : stored.name,
            type: 'markdown',
            pinned: stored.pinned,
            state,
            savedDoc,
            sourceSnapshot: {
              source: stored.sourceContent ?? stored.savedContent,
              canonical: stored.baselineContent ?? savedCanonical,
            },
            dirty: stored.dirty,
            missing: stored.missing,
            diskRevision: stored.diskRevision ?? null,
          },
        ];
      } catch (error) {
        console.warn(`Could not restore “${stored.name}”.`, error);
        return [];
      }
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
    return null;
  }
}

function createPersistedSession(editor: EditorApi, snapshot: TabsState): PersistedSessionV2 {
  const documents = snapshot.tabs.flatMap((tab): PersistedDocumentV2[] => {
    if (!isMarkdownTab(tab) || (tab.path !== null && !tab.dirty)) return [];
    return [
      {
        id: tab.id,
        path: tab.path,
        name: tab.name,
        pinned: tab.pinned,
        content: editor.serializeState(tab.state),
        savedContent: editor.serializeNode(tab.savedDoc),
        dirty: tab.dirty,
        missing: tab.missing,
        selection: { anchor: tab.state.selection.anchor, head: tab.state.selection.head },
        diskRevision: tab.diskRevision,
        sourceContent: tab.sourceSnapshot?.source ?? editor.serializeNode(tab.savedDoc),
        baselineContent: tab.sourceSnapshot?.canonical ?? editor.serializeNode(tab.savedDoc),
      },
    ];
  });
  return {
    version: 2,
    documents,
    activeId: documents.some((document) => document.id === snapshot.activeId)
      ? snapshot.activeId
      : null,
  };
}

function enqueuePersist(session: PersistedSessionV2): Promise<void> {
  const operation = persistChain
    .catch(() => undefined)
    .then(() => writePersistedDocumentSession(session));
  persistChain = operation;
  void operation.catch((error) => console.warn('Could not persist session-v2.json.', error));
  return operation;
}

export function persistDocumentSession(editor: EditorApi, snapshot: TabsState): void {
  void enqueuePersist(createPersistedSession(editor, snapshot));
}

export async function flushDocumentSession(editor: EditorApi, snapshot: TabsState): Promise<void> {
  await enqueuePersist(createPersistedSession(editor, snapshot));
}

export function activeMarkdownTab(session: RestoredDocumentSession): MarkdownTab | undefined {
  return session.tabs.find(
    (tab): tab is MarkdownTab => tab.id === session.activeId && isMarkdownTab(tab),
  );
}

export function resetDocumentSessionState(): void {
  loadedSession = undefined;
  persistChain = Promise.resolve();
}
