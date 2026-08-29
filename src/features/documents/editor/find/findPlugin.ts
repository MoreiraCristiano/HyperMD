import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

type FindMatch = { from: number; to: number };

export type FindState = {
  query: string;
  matches: FindMatch[];
  activeIndex: number;
  decorations: DecorationSet;
};

type FindAction =
  { type: 'query'; query: string } | { type: 'active'; activeIndex: number } | { type: 'clear' };

const findPluginKey = new PluginKey<FindState>('document-find');

function emptyFindState(): FindState {
  return { query: '', matches: [], activeIndex: -1, decorations: DecorationSet.empty };
}

function buildFindState(doc: ProseMirrorNode, query: string, requestedIndex = 0): FindState {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return emptyFindState();

  const matches: FindMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text.toLocaleLowerCase();
    let offset = 0;
    while (offset <= text.length - needle.length) {
      const index = text.indexOf(needle, offset);
      if (index === -1) break;
      matches.push({ from: pos + index, to: pos + index + needle.length });
      offset = index + Math.max(1, needle.length);
    }
  });

  if (matches.length === 0) {
    return { query, matches, activeIndex: -1, decorations: DecorationSet.empty };
  }
  const activeIndex = ((requestedIndex % matches.length) + matches.length) % matches.length;
  const decorations = DecorationSet.create(
    doc,
    matches.map((match, index) => {
      const active = index === activeIndex;
      return Decoration.inline(
        match.from,
        match.to,
        { class: active ? 'find-match active' : 'find-match' },
        { documentFind: true, active },
      );
    }),
  );
  return { query, matches, activeIndex, decorations };
}

function pluginState(view: EditorView): FindState {
  return findPluginKey.getState(view.state) ?? emptyFindState();
}

export function findRangesInside(
  state: EditorState,
  from: number,
  to: number,
): Array<FindMatch & { active: boolean }> {
  const current = findPluginKey.getState(state) ?? emptyFindState();
  return current.matches.flatMap((match, index) =>
    match.from >= from && match.to <= to
      ? [{ from: match.from - from, to: match.to - from, active: index === current.activeIndex }]
      : [],
  );
}

function selectActiveMatch(view: EditorView, state: FindState): void {
  const match = state.matches[state.activeIndex];
  if (!match) return;
  view.dispatch(
    view.state.tr
      .setMeta(findPluginKey, {
        type: 'active',
        activeIndex: state.activeIndex,
      } satisfies FindAction)
      .setSelection(TextSelection.create(view.state.doc, match.from, match.to))
      .scrollIntoView(),
  );
}

export function findText(view: EditorView, query: string): FindState {
  view.dispatch(
    view.state.tr.setMeta(findPluginKey, { type: 'query', query } satisfies FindAction),
  );
  const state = pluginState(view);
  selectActiveMatch(view, state);
  return pluginState(view);
}

export function moveFindMatch(view: EditorView, direction: number): FindState {
  const state = pluginState(view);
  if (state.matches.length === 0) return state;
  const activeIndex = (state.activeIndex + direction + state.matches.length) % state.matches.length;
  selectActiveMatch(view, { ...state, activeIndex });
  return pluginState(view);
}

export function clearFind(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(findPluginKey, { type: 'clear' } satisfies FindAction));
}

export const DocumentFind = Extension.create({
  name: 'documentFind',

  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findPluginKey,
        state: {
          init: emptyFindState,
          apply(transaction, current) {
            const action = transaction.getMeta(findPluginKey) as FindAction | undefined;
            if (action?.type === 'clear') return emptyFindState();
            if (action?.type === 'query') return buildFindState(transaction.doc, action.query);
            if (action?.type === 'active') {
              return buildFindState(transaction.doc, current.query, action.activeIndex);
            }
            return transaction.docChanged
              ? buildFindState(transaction.doc, current.query, current.activeIndex)
              : current;
          },
        },
        props: {
          decorations(state) {
            return findPluginKey.getState(state)?.decorations ?? null;
          },
        },
      }),
    ];
  },
});
