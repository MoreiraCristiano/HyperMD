import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import { derived, writable } from 'svelte/store';

type BaseTab = {
  id: string;
  path: string | null;
  name: string;
  type: 'markdown' | 'image' | 'settings';
  dirty: boolean;
  missing: boolean;
};

export type MarkdownTab = BaseTab & {
  type: 'markdown';
  state: EditorState;
  savedDoc: ProseMirrorNode;
};

export type ImageTab = BaseTab & {
  type: 'image';
  path: string;
  dirty: false;
};

export type SettingsTab = BaseTab & {
  type: 'settings';
  path: null;
  dirty: false;
  missing: false;
};

export type EditorTab = MarkdownTab | ImageTab | SettingsTab;

export function isMarkdownTab(tab: EditorTab): tab is MarkdownTab {
  return tab.type === 'markdown';
}

export type TabsState = {
  tabs: EditorTab[];
  activeId: string | null;
  ready: boolean;
};

export const tabsState = writable<TabsState>({ tabs: [], activeId: null, ready: false });

export const activeTab = derived(tabsState, ($tabsState) =>
  $tabsState.tabs.find((tab) => tab.id === $tabsState.activeId),
);
