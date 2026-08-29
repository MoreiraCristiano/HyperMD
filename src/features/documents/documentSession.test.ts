import { describe, expect, it, vi } from 'vitest';
import type { EditorApi } from './editor/editorTypes';
import {
  DOCUMENT_SESSION_KEY,
  persistDocumentSession,
  restoreDocumentSession,
} from './documentSession';
import type { TabsState } from './tabs/tabStore';

const editor = {
  createState: vi.fn(),
  serializeState: vi.fn(),
  serializeNode: vi.fn(),
} as unknown as EditorApi;

describe('document session', () => {
  it('removes corrupted persisted state', () => {
    localStorage.setItem(DOCUMENT_SESSION_KEY, '{bad');
    expect(restoreDocumentSession(editor)).toBeNull();
    expect(localStorage.getItem(DOCUMENT_SESSION_KEY)).toBeNull();
  });

  it('persists document tabs while excluding application views', () => {
    const snapshot: TabsState = {
      activeId: 'image',
      ready: true,
      tabs: [
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
    persistDocumentSession(editor, snapshot);
    const stored = JSON.parse(localStorage.getItem(DOCUMENT_SESSION_KEY) ?? '{}');
    expect(stored.tabs).toHaveLength(1);
    expect(stored.tabs[0]).toMatchObject({ id: 'image', type: 'image' });
  });
});
