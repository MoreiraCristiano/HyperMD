import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sidebarState } from '@/features/workspace/workspaceStore';
import { MarkdownImage } from './extensions/image';
import { rewriteImageReferences } from './imageReferences';
import { MarkdownSupport } from './markdown';

let editor: Editor;

describe('image reference rewriting', () => {
  beforeEach(() => {
    sidebarState.update((state) => ({
      ...state,
      workspacePath: '/work',
      workspaceName: 'Work',
    }));
    editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit, MarkdownImage, MarkdownSupport],
      content:
        '![Alt](../images/a.png?raw=1 "Title")\n\n![Other](../other/a.png)\n\n![Web](https://example.com/a.png)',
      contentType: 'markdown',
    });
  });

  afterEach(() => editor.destroy());

  it('rewrites only references that resolve to the moved image', async () => {
    const rewritten = await rewriteImageReferences(
      editor.state,
      '/work/docs/note.md',
      '/work/images/a.png',
      '/work/media/a.png',
    );

    expect(rewritten.changed).toBe(true);
    const images: Array<Record<string, unknown>> = [];
    rewritten.state.doc.descendants((node) => {
      if (node.type.name === 'image') images.push(node.attrs);
    });
    expect(images).toEqual([
      expect.objectContaining({
        src: '../media/a.png?raw=1',
        alt: 'Alt',
        title: 'Title',
      }),
      expect.objectContaining({ src: '../other/a.png', alt: 'Other' }),
      expect.objectContaining({ src: 'https://example.com/a.png', alt: 'Web' }),
    ]);
  });

  it('returns the original state when no reference matches', async () => {
    const rewritten = await rewriteImageReferences(
      editor.state,
      '/work/docs/note.md',
      '/work/images/missing.png',
      '/work/media/missing.png',
    );
    expect(rewritten).toEqual({ state: editor.state, changed: false });
  });
});
