import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

const highlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: 'var(--syntax-keyword)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--syntax-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--syntax-number)' },
  { tag: [tags.function(tags.variableName), tags.labelName], color: 'var(--syntax-function)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--syntax-type)' },
  {
    tag: [tags.variableName, tags.propertyName, tags.attributeName],
    color: 'var(--syntax-variable)',
  },
  {
    tag: [tags.definition(tags.variableName), tags.definition(tags.propertyName)],
    color: 'var(--syntax-operator)',
  },
  { tag: [tags.operator, tags.punctuation, tags.separator], color: 'var(--syntax-operator)' },
  { tag: [tags.tagName, tags.deleted], color: 'var(--syntax-deleted)' },
  { tag: [tags.regexp, tags.escape, tags.inserted], color: 'var(--syntax-operator)' },
  { tag: [tags.heading, tags.strong], color: 'var(--syntax-heading)', fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: [tags.link, tags.url], color: 'var(--syntax-function)', textDecoration: 'underline' },
  { tag: tags.invalid, color: 'var(--syntax-invalid)' },
]);

export const codeMirrorTheme = [
  EditorView.theme({
    '&': {
      height: 'auto',
      backgroundColor: 'var(--code-background)',
      color: 'var(--code-text)',
      fontFamily: 'var(--code-block-font-family)',
      fontSize: '0.82em',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: 'inherit',
      lineHeight: '1.58',
    },
    '.cm-content': {
      minWidth: 'max-content',
      padding: '16px 20px 16px 8px',
      caretColor: 'var(--code-caret)',
    },
    '.cm-line': { padding: '0' },
    '.cm-gutters': {
      border: 'none',
      borderRight: '1px solid var(--code-border)',
      backgroundColor: 'var(--code-gutter-background)',
      color: 'var(--code-line-number)',
      padding: '0 7px 0 9px',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      minWidth: '2.5ch',
      padding: '0 5px 0 0',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: 'var(--code-line-number-active)',
    },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'var(--code-selection) !important',
    },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--code-caret)' },
    '.cm-find-match': { borderRadius: '2px', backgroundColor: 'var(--code-find)' },
    '.cm-find-match-active': {
      outline: '1px solid var(--code-find-border)',
      backgroundColor: 'var(--code-find-active)',
    },
  }),
  syntaxHighlighting(highlightStyle),
];
