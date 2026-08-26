import { Markdown } from '@tiptap/markdown';

export const MarkdownSupport = Markdown.configure({
  markedOptions: {
    gfm: true,
  },
});
