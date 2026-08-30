import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import { derived, writable } from 'svelte/store';
import type { MarkdownSourceSnapshot } from '../markdownSource';

type BaseTab = {
  id: string;
  path: string | null;
  name: string;
  type: 'markdown' | 'image' | 'settings' | 'shortcuts';
  pinned: boolean;
  dirty: boolean;
  missing: boolean;
};

export type MarkdownTab = BaseTab & {
  type: 'markdown';
  state: EditorState;
  savedDoc: ProseMirrorNode;
  diskRevision?: string | null;
  sourceSnapshot?: MarkdownSourceSnapshot;
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

export type ShortcutsTab = BaseTab & {
  type: 'shortcuts';
  path: null;
  dirty: false;
  missing: false;
};

export type EditorTab = MarkdownTab | ImageTab | SettingsTab | ShortcutsTab;

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
