import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tauriMocks } from '@/test/tauriMocks';
import type { EditorApi } from './editor/editorTypes';
import {
  DOCUMENT_SESSION_KEY,
  flushDocumentSession,
  initializeDocumentSession,
  resetDocumentSessionState,
  restoreDocumentSession,
} from './documentSession';
import type { TabsState } from './tabs/tabStore';

function fakeState(content: string): EditorState {
  return {
    doc: { content } as unknown as ProseMirrorNode,
    selection: { anchor: 1, head: 2 },
  } as unknown as EditorState;
}

function fakeEditor(): EditorApi {
  return {
    createState: vi.fn((markdown: string) => fakeState(markdown)),
    serializeState: vi.fn((state: EditorState) =>
      String((state.doc as unknown as { content: string }).content),
    ),
    serializeNode: vi.fn((doc: ProseMirrorNode) =>
      String((doc as unknown as { content: string }).content),
    ),
  } as unknown as EditorApi;
}

describe('document session', () => {
  beforeEach(() => {
    resetDocumentSessionState();
    tauriMocks.exists.mockResolvedValue(false);
  });

  it('keeps malformed legacy data available for rollback', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(DOCUMENT_SESSION_KEY, '{bad');

    await initializeDocumentSession();

    expect(restoreDocumentSession(fakeEditor())).toBeNull();
    expect(localStorage.getItem(DOCUMENT_SESSION_KEY)).toBe('{bad');
    expect(warn).toHaveBeenCalledWith(
      'Could not read the legacy document session.',
      expect.any(SyntaxError),
    );
  });

  it('migrates recoverable v1 documents to session-v2.json without deleting v1', async () => {
    localStorage.setItem(
      DOCUMENT_SESSION_KEY,
      JSON.stringify({
        activeId: 'dirty-file',
        tabs: [
          {
            id: 'untitled',
            path: null,
            name: 'Sem título.md',
            type: 'markdown',
            content: 'draft',
            savedContent: '',
            dirty: true,
          },
          {
            id: 'dirty-file',
            path: '/work/dirty.md',
            name: 'dirty.md',
            type: 'markdown',
            content: 'changed',
            savedContent: 'saved',
            dirty: true,
          },
          {
            id: 'clean-file',
            path: '/work/clean.md',
            name: 'clean.md',
            type: 'markdown',
            content: 'clean',
            savedContent: 'clean',
            dirty: false,
          },
          {
            id: 'image',
            path: '/work/photo.png',
            name: 'photo.png',
            type: 'image',
          },
        ],
      }),
    );

    await initializeDocumentSession();

    expect(tauriMocks.atomicWriteTextFile).toHaveBeenCalledWith(
      'session-v2.json',
      expect.any(String),
      13,
    );
    const persisted = JSON.parse(tauriMocks.atomicWriteTextFile.mock.calls[0][1]);
    expect(persisted).toMatchObject({
      version: 2,
      activeId: 'dirty-file',
      documents: [{ id: 'untitled', name: 'Untitled.md' }, { id: 'dirty-file' }],
    });
    expect(localStorage.getItem(DOCUMENT_SESSION_KEY)).not.toBeNull();

    const restored = restoreDocumentSession(fakeEditor());
    expect(restored).toMatchObject({
      activeId: 'dirty-file',
      ready: true,
      tabs: [{ id: 'untitled', name: 'Untitled.md' }, { id: 'dirty-file' }],
    });
  });

  it('prefers v2 over the legacy fallback', async () => {
    localStorage.setItem(
      DOCUMENT_SESSION_KEY,
      JSON.stringify({
        activeId: 'legacy',
        tabs: [{ id: 'legacy', path: null, name: 'legacy.md', content: 'old' }],
      }),
    );
    tauriMocks.exists.mockResolvedValue(true);
    tauriMocks.readTextFile.mockResolvedValue(
      JSON.stringify({
        version: 2,
        activeId: 'v2',
        documents: [
          {
            id: 'v2',
            path: null,
            name: 'v2.md',
            pinned: false,
            content: 'new',
            savedContent: '',
            dirty: true,
            missing: false,
          },
        ],
      }),
    );

    await initializeDocumentSession();

    expect(restoreDocumentSession(fakeEditor())).toMatchObject({
      activeId: 'v2',
      tabs: [{ id: 'v2', name: 'v2.md' }],
    });
    expect(tauriMocks.atomicWriteTextFile).not.toHaveBeenCalled();
  });

  it('persists only untitled and dirty Markdown documents', async () => {
    const editor = fakeEditor();
    const snapshot: TabsState = {
      activeId: 'image',
      ready: true,
      tabs: [
        {
          id: 'untitled',
          path: null,
          name: 'Untitled.md',
          type: 'markdown',
          pinned: false,
          state: fakeState('draft'),
          savedDoc: fakeState('').doc,
          dirty: true,
          missing: false,
        },
        {
          id: 'dirty-file',
          path: '/work/dirty.md',
          name: 'dirty.md',
          type: 'markdown',
          pinned: true,
          state: fakeState('changed'),
          savedDoc: fakeState('saved').doc,
          sourceSnapshot: {
            source: '<!-- private -->\r\nsaved',
            canonical: 'saved',
          },
          dirty: true,
          missing: false,
        },
        {
          id: 'clean-file',
          path: '/work/clean.md',
          name: 'clean.md',
          type: 'markdown',
          pinned: false,
          state: fakeState('clean'),
          savedDoc: fakeState('clean').doc,
          dirty: false,
          missing: false,
        },
        {
          id: 'image',
          path: '/work/photo.png',
          name: 'photo.png',
          type: 'image',
          pinned: false,
          dirty: false,
          missing: false,
        },
        {
          id: 'settings',
          path: null,
          name: 'Settings',
          type: 'settings',
          pinned: false,
          dirty: false,
          missing: false,
        },
      ],
    };

    await flushDocumentSession(editor, snapshot);

    const persisted = JSON.parse(tauriMocks.atomicWriteTextFile.mock.calls[0][1]);
    expect(persisted).toMatchObject({
      version: 2,
      activeId: null,
      documents: [
        { id: 'untitled' },
        {
          id: 'dirty-file',
          pinned: true,
          sourceContent: '<!-- private -->\r\nsaved',
          baselineContent: 'saved',
        },
      ],
    });
  });

  it('keeps migrated recovery data usable when the v2 write fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const legacy = {
      activeId: 'draft',
      tabs: [{ id: 'draft', path: null, name: 'draft.md', content: 'safe', dirty: true }],
    };
    localStorage.setItem(DOCUMENT_SESSION_KEY, JSON.stringify(legacy));
    tauriMocks.atomicWriteTextFile.mockRejectedValueOnce(new Error('disk full'));

    await expect(initializeDocumentSession()).resolves.toBeUndefined();

    expect(restoreDocumentSession(fakeEditor())).toMatchObject({ tabs: [{ id: 'draft' }] });
    expect(localStorage.getItem(DOCUMENT_SESSION_KEY)).toBe(JSON.stringify(legacy));
    expect(warn).toHaveBeenCalledWith(
      'Could not migrate the legacy document session.',
      expect.any(Error),
    );
  });

  it('does not overwrite an unsupported future session version', async () => {
    tauriMocks.exists.mockResolvedValue(true);
    tauriMocks.readTextFile.mockResolvedValue(JSON.stringify({ version: 3, documents: [] }));
    localStorage.setItem(
      DOCUMENT_SESSION_KEY,
      JSON.stringify({ tabs: [{ id: 'legacy', path: null, content: 'old' }] }),
    );

    await initializeDocumentSession();

    expect(restoreDocumentSession(fakeEditor())).toBeNull();
    expect(tauriMocks.atomicWriteTextFile).not.toHaveBeenCalled();
    expect(localStorage.getItem(DOCUMENT_SESSION_KEY)).not.toBeNull();
  });
});
