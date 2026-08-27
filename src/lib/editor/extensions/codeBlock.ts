import { textblockTypeInputRule, type NodeViewRendererProps } from '@tiptap/core';
import CodeBlock from '@tiptap/extension-code-block';
import { exitCode } from '@tiptap/pm/commands';
import { undo, redo } from '@tiptap/pm/history';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Selection, TextSelection } from '@tiptap/pm/state';
import type { EditorView as ProseMirrorEditorView, NodeView } from '@tiptap/pm/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import {
  Compartment,
  EditorState as CodeMirrorState,
  StateEffect,
  StateField,
} from '@codemirror/state';
import {
  Decoration as CodeMirrorDecoration,
  type DecorationSet as CodeMirrorDecorationSet,
  drawSelection,
  EditorView as CodeMirrorEditorView,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { loadCodeLanguage } from '../codeblock/languages';
import { CodeLanguageSelector } from '../codeblock/languageSelector';
import { codeMirrorTheme } from '../codeblock/theme';
import { findRangesInside } from '../find/findPlugin';

type FindRange = { from: number; to: number; active: boolean };

const setFindRanges = StateEffect.define<readonly FindRange[]>();
const findRangesField = StateField.define<CodeMirrorDecorationSet>({
  create: () => CodeMirrorDecoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setFindRanges)) continue;
      next = CodeMirrorDecoration.set(
        effect.value.map((range) =>
          CodeMirrorDecoration.mark({
            class: range.active ? 'cm-find-match cm-find-match-active' : 'cm-find-match',
          }).range(range.from, range.to),
        ),
        true,
      );
    }
    return next;
  },
  provide: (field) => CodeMirrorEditorView.decorations.from(field),
});

export class CodeMirrorBlockView implements NodeView {
  dom: HTMLElement;
  private node: ProseMirrorNode;
  private readonly outerView: ProseMirrorEditorView;
  private readonly getPos: NodeViewRendererProps['getPos'];
  private readonly codeMirror: CodeMirrorEditorView;
  private readonly languageSelector: CodeLanguageSelector;
  private readonly language = new Compartment();
  private updating = false;
  private languageRequest = 0;
  private destroyed = false;

  constructor({ node, view, getPos }: NodeViewRendererProps) {
    this.node = node;
    this.outerView = view;
    this.getPos = getPos;
    this.languageSelector = new CodeLanguageSelector(
      node.attrs.language as string | null,
      (language) => this.setLanguage(language),
    );
    this.codeMirror = new CodeMirrorEditorView({
      state: CodeMirrorState.create({
        doc: node.textContent,
        extensions: [
          lineNumbers(),
          drawSelection(),
          CodeMirrorState.tabSize.of(2),
          indentUnit.of('  '),
          CodeMirrorEditorView.contentAttributes.of({
            spellcheck: 'false',
            autocorrect: 'off',
            autocapitalize: 'off',
            'aria-label': 'Code block',
          }),
          keymap.of([
            { key: 'ArrowUp', run: () => this.maybeEscape('line', -1) },
            { key: 'ArrowLeft', run: () => this.maybeEscape('char', -1) },
            { key: 'ArrowDown', run: () => this.maybeEscape('line', 1) },
            { key: 'ArrowRight', run: () => this.maybeEscape('char', 1) },
            { key: 'Shift-Enter', run: () => this.exitCodeBlock() },
            { key: 'Ctrl-Enter', mac: 'Cmd-Enter', run: () => this.exitCodeBlock() },
            {
              key: 'Ctrl-z',
              mac: 'Cmd-z',
              run: () => undo(this.outerView.state, this.outerView.dispatch),
            },
            {
              key: 'Shift-Ctrl-z',
              mac: 'Shift-Cmd-z',
              run: () => redo(this.outerView.state, this.outerView.dispatch),
            },
            {
              key: 'Ctrl-y',
              mac: 'Cmd-y',
              run: () => redo(this.outerView.state, this.outerView.dispatch),
            },
            indentWithTab,
            ...defaultKeymap,
          ]),
          findRangesField,
          this.language.of([]),
          ...codeMirrorTheme,
          CodeMirrorEditorView.updateListener.of((update) => {
            if (update.docChanged || update.selectionSet) this.forwardUpdate();
          }),
        ],
      }),
    });
    this.dom = document.createElement('div');
    this.dom.className = 'hypermd-code-block';
    this.dom.append(this.languageSelector.dom, this.codeMirror.dom);
    this.updateFindRanges();
    void this.updateLanguage(node.attrs.language as string | null);
  }

  update(
    node: ProseMirrorNode,
    _decorations: readonly unknown[],
    _innerDecorations: NodeViewRendererProps['innerDecorations'],
  ): boolean {
    if (node.type !== this.node.type) return false;

    const previousLanguage = this.node.attrs.language as string | null;
    this.node = node;
    const currentText = this.codeMirror.state.doc.toString();
    if (node.textContent !== currentText) {
      const change = minimalChange(currentText, node.textContent);
      if (change) {
        this.updating = true;
        this.codeMirror.dispatch({ changes: change });
        this.updating = false;
      }
    }

    this.updateFindRanges();
    const nextLanguage = node.attrs.language as string | null;
    if (nextLanguage !== previousLanguage) {
      this.languageSelector.update(nextLanguage);
      void this.updateLanguage(nextLanguage);
    }
    return true;
  }

  setSelection(anchor: number, head: number): void {
    this.updating = true;
    this.codeMirror.focus();
    this.codeMirror.dispatch({ selection: { anchor, head } });
    this.updating = false;
  }

  stopEvent(): boolean {
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.destroyed = true;
    this.languageRequest += 1;
    this.languageSelector.destroy();
    this.codeMirror.destroy();
  }

  private forwardUpdate(): void {
    if (this.updating || !this.codeMirror.hasFocus) return;

    const start = this.position() + 1;
    const selection = this.codeMirror.state.selection.main;
    let transaction = this.outerView.state.tr;

    const changes = this.codeMirror.state.doc.toString();
    if (changes !== this.node.textContent) {
      const change = minimalChange(this.node.textContent, changes);
      if (change) {
        const inserted = change.insert;
        transaction = inserted.length
          ? transaction.replaceWith(
              start + change.from,
              start + change.to,
              this.outerView.state.schema.text(inserted),
            )
          : transaction.delete(start + change.from, start + change.to);
      }
    }

    const anchor = Math.min(transaction.doc.content.size, start + selection.anchor);
    const head = Math.min(transaction.doc.content.size, start + selection.head);
    transaction = transaction.setSelection(TextSelection.create(transaction.doc, anchor, head));
    this.outerView.dispatch(transaction);
  }

  private maybeEscape(unit: 'line' | 'char', direction: -1 | 1): boolean {
    const { state } = this.codeMirror;
    const { main } = state.selection;
    if (!main.empty) return false;

    if (unit === 'line') {
      const line = state.doc.lineAt(main.head);
      if (direction < 0 ? line.number !== 1 : line.number !== state.doc.lines) return false;
    } else if (direction < 0 ? main.head > 0 : main.head < state.doc.length) {
      return false;
    }

    const target = this.position() + (direction < 0 ? 0 : this.node.nodeSize);
    const selection = Selection.near(this.outerView.state.doc.resolve(target), direction);
    this.outerView.dispatch(this.outerView.state.tr.setSelection(selection).scrollIntoView());
    this.outerView.focus();
    return true;
  }

  private exitCodeBlock(): boolean {
    if (!exitCode(this.outerView.state, this.outerView.dispatch)) return false;
    this.outerView.focus();
    return true;
  }

  private position(): number {
    const position = this.getPos();
    if (position === undefined) throw new Error('Code block is outside the document.');
    return position;
  }

  private updateFindRanges(): void {
    const from = this.position() + 1;
    const ranges = findRangesInside(this.outerView.state, from, from + this.node.content.size);
    this.codeMirror.dispatch({ effects: setFindRanges.of(ranges) });
  }

  private async updateLanguage(language: string | null): Promise<void> {
    const request = ++this.languageRequest;
    const support = await loadCodeLanguage(language);
    if (this.destroyed || request !== this.languageRequest) return;
    this.codeMirror.dispatch({ effects: this.language.reconfigure(support ?? []) });
  }

  private setLanguage(language: string | null): void {
    const position = this.position();
    this.outerView.dispatch(
      this.outerView.state.tr
        .setNodeMarkup(position, undefined, { ...this.node.attrs, language })
        .scrollIntoView(),
    );
    queueMicrotask(() => this.codeMirror.focus());
  }
}

export function minimalChange(
  previous: string,
  next: string,
): { from: number; to: number; insert: string } | null {
  if (previous === next) return null;

  let from = 0;
  const sharedLength = Math.min(previous.length, next.length);
  while (from < sharedLength && previous.charCodeAt(from) === next.charCodeAt(from)) from += 1;

  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (
    previousEnd > from &&
    nextEnd > from &&
    previous.charCodeAt(previousEnd - 1) === next.charCodeAt(nextEnd - 1)
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }

  return { from, to: previousEnd, insert: next.slice(from, nextEnd) };
}

export const CodeMirrorCodeBlock = CodeBlock.extend({
  addNodeView() {
    return (props) => new CodeMirrorBlockView(props);
  },

  addInputRules() {
    return [
      textblockTypeInputRule({
        find: /^```([a-zA-Z0-9_+#.-]+)?[\s\n]$/,
        type: this.type,
        getAttributes: (match) => ({ language: match[1] }),
      }),
      textblockTypeInputRule({
        find: /^~~~([a-zA-Z0-9_+#.-]+)?[\s\n]$/,
        type: this.type,
        getAttributes: (match) => ({ language: match[1] }),
      }),
    ];
  },
}).configure({
  enableTabIndentation: false,
  tabSize: 2,
  HTMLAttributes: { spellcheck: 'false' },
});
