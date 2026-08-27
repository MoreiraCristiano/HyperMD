import type { EditorState } from '@tiptap/pm/state';
import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { activeTab, isMarkdownTab, tabsState, type EditorTab } from './tabStore';

describe('tab store', () => {
  it('derives active tab and narrows Markdown tabs', () => {
    const tab = {
      id: 'one',
      path: null,
      name: 'One.md',
      type: 'markdown',
      pinned: false,
      dirty: false,
      missing: false,
      state: { doc: {} } as EditorState,
      savedDoc: {},
    } as EditorTab;
    expect(isMarkdownTab(tab)).toBe(true);
    tabsState.set({ tabs: [tab], activeId: 'one', ready: true });
    expect(get(activeTab)).toBe(tab);
    tabsState.update((state) => ({ ...state, activeId: null }));
    expect(get(activeTab)).toBeUndefined();
  });
});
