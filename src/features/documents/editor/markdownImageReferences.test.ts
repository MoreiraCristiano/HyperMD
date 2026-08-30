import { beforeEach, describe, expect, it } from 'vitest';
import { sidebarState } from '@/features/workspace/workspaceStore';
import { rewriteMarkdownImageReferences } from './markdownImageReferences';

describe('lossless Markdown image reference rewriting', () => {
  beforeEach(() => {
    sidebarState.update((state) => ({
      ...state,
      workspacePath: '/work',
      workspaceName: 'Work',
    }));
  });

  it('changes only matching inline and reference destinations', async () => {
    const source = [
      '---',
      'title: Private',
      '---',
      '<!-- keep -->',
      '![Inline](../images/a.png?raw=1 "Title")',
      '![Referenced][asset]',
      '![Other](../other/a.png)',
      '',
      '[asset]: <../images/a.png> "Reference title"',
      '',
    ].join('\n');

    const result = await rewriteMarkdownImageReferences(
      source,
      '/work/docs/note.md',
      '/work/images/a.png',
      '/work/media/a.png',
    );

    expect(result).toEqual({
      changed: true,
      source: source
        .replace('../images/a.png?raw=1', '../media/a.png?raw=1')
        .replace('<../images/a.png>', '<../media/a.png>'),
    });
  });

  it('ignores image-like text in comments, fenced code, and inline code', async () => {
    const source = [
      '<!-- ![](../images/a.png) -->',
      '```md',
      '![](../images/a.png)',
      '```',
      '`![](../images/a.png)`',
      '',
    ].join('\n');

    await expect(
      rewriteMarkdownImageReferences(
        source,
        '/work/docs/note.md',
        '/work/images/a.png',
        '/work/media/a.png',
      ),
    ).resolves.toEqual({ source, changed: false });
  });
});
