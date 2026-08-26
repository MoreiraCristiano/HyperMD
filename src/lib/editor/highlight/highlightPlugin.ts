import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { canonicalLanguage } from '../codeblock/languages';
import { highlightCode } from './shiki';

const pluginKey = new PluginKey<DecorationSet>('shiki-highlighting');

async function decorationsFor(doc: ProseMirrorNode): Promise<DecorationSet> {
  const blocks: { code: string; language: string | null; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock' && node.textContent) {
      blocks.push({
        code: node.textContent,
        language: canonicalLanguage(node.attrs.language),
        pos,
      });
    }
  });
  if (blocks.length === 0) return DecorationSet.empty;

  const highlighted = await Promise.all(
    blocks.map(async (block) => ({
      block,
      spans: await highlightCode(block.code, block.language),
    })),
  );
  const decorations = highlighted.flatMap(({ block, spans }) =>
    spans.map((span) =>
      Decoration.inline(block.pos + 1 + span.from, block.pos + 1 + span.to, {
        class: 'shiki-token',
        style: span.style,
      }),
    ),
  );
  return DecorationSet.create(doc, decorations);
}

export const ShikiHighlight = Extension.create({
  name: 'shikiHighlight',

  addProseMirrorPlugins() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let generation = 0;

    return [
      new Plugin<DecorationSet>({
        key: pluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(transaction, current) {
            const replacement = transaction.getMeta(pluginKey) as DecorationSet | undefined;
            if (replacement) return replacement;
            return transaction.docChanged
              ? current.map(transaction.mapping, transaction.doc)
              : current;
          },
        },
        props: {
          decorations(state) {
            return pluginKey.getState(state);
          },
        },
        view: (view) => {
          const schedule = () => {
            clearTimeout(timer);
            const currentGeneration = ++generation;
            timer = setTimeout(async () => {
              const sourceDoc = view.state.doc;
              try {
                const decorations = await decorationsFor(sourceDoc);
                if (currentGeneration === generation && sourceDoc.eq(view.state.doc)) {
                  view.dispatch(view.state.tr.setMeta(pluginKey, decorations));
                }
              } catch (error) {
                console.warn('Shiki highlighting unavailable', error);
              }
            }, 100);
          };

          schedule();
          return {
            update(updatedView, previousState) {
              if (!updatedView.state.doc.eq(previousState.doc)) schedule();
            },
            destroy() {
              generation += 1;
              clearTimeout(timer);
            },
          };
        },
      }),
    ];
  },
});
