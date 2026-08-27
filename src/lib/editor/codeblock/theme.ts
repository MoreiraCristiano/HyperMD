import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

const highlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: '#737a72', fontStyle: 'italic' },
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: '#c792ea' },
  { tag: [tags.string, tags.special(tags.string)], color: '#c3e88d' },
  { tag: [tags.number, tags.bool, tags.null], color: '#f78c6c' },
  { tag: [tags.function(tags.variableName), tags.labelName], color: '#82aaff' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: '#ffcb6b' },
  { tag: [tags.variableName, tags.propertyName, tags.attributeName], color: '#d9d9d6' },
  {
    tag: [tags.definition(tags.variableName), tags.definition(tags.propertyName)],
    color: '#89ddff',
  },
  { tag: [tags.operator, tags.punctuation, tags.separator], color: '#89ddff' },
  { tag: [tags.tagName, tags.deleted], color: '#f07178' },
  { tag: [tags.regexp, tags.escape, tags.inserted], color: '#89ddff' },
  { tag: [tags.heading, tags.strong], color: '#f2f2f0', fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: [tags.link, tags.url], color: '#82aaff', textDecoration: 'underline' },
  { tag: tags.invalid, color: '#ff5370' },
]);

export const codeMirrorTheme = [
  EditorView.theme(
    {
      '&': {
        height: 'auto',
        backgroundColor: '#111212',
        color: '#d9d9d6',
        fontFamily: 'var(--editor-font-family)',
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
        caretColor: '#f2f2f0',
      },
      '.cm-line': { padding: '0' },
      '.cm-gutters': {
        border: 'none',
        borderRight: '1px solid #292a29',
        backgroundColor: '#111212',
        color: '#555b56',
        padding: '0 7px 0 9px',
      },
      '.cm-lineNumbers .cm-gutterElement': {
        minWidth: '2.5ch',
        padding: '0 5px 0 0',
      },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#969d97' },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
        backgroundColor: '#274d68 !important',
      },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#f2f2f0' },
      '.cm-find-match': { borderRadius: '2px', backgroundColor: '#6b552f' },
      '.cm-find-match-active': {
        outline: '1px solid #d0a75c',
        backgroundColor: '#96723a',
      },
    },
    { dark: true },
  ),
  syntaxHighlighting(highlightStyle),
];
