import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { tauriMocks } from '../../test/tauriMocks';
import { sidebarState } from '../sidebar/sidebarStore';
import {
  markdownImageUrl,
  relativeMarkdownImagePath,
  resolveMarkdownImagePath,
  validateWorkspaceImagePath,
  workspaceImageUrl,
} from './localImage';

describe('local images', () => {
  beforeEach(() => {
    sidebarState.set({
      ...get(sidebarState),
      workspacePath: '/work',
      workspaceName: 'work',
    });
    tauriMocks.stat.mockResolvedValue({ isFile: true });
  });

  it('validates image type, workspace boundary, and file metadata', async () => {
    await expect(validateWorkspaceImagePath('/work/a.png')).resolves.toBe('/work/a.png');
    await expect(validateWorkspaceImagePath('/work/a.md')).rejects.toThrow('Unsupported');
    await expect(validateWorkspaceImagePath('/outside/a.png')).rejects.toThrow('outside');
    tauriMocks.stat.mockResolvedValue({ isFile: false });
    await expect(validateWorkspaceImagePath('/work/folder.png')).rejects.toThrow('valid file');
    sidebarState.update((state) => ({ ...state, workspacePath: null }));
    await expect(validateWorkspaceImagePath('/work/a.png')).rejects.toThrow('Open the workspace');
  });

  it('converts validated workspace images to asset URLs', async () => {
    await expect(workspaceImageUrl('/work/a.png')).resolves.toBe('asset:///work/a.png');
    expect(tauriMocks.convertFileSrc).toHaveBeenCalledWith('/work/a.png');
  });

  it('creates portable Markdown paths for local images', () => {
    expect(relativeMarkdownImagePath('/work/docs', '/work/docs/a.png')).toBe('./a.png');
    expect(relativeMarkdownImagePath('/work/docs', '/work/images/a.png')).toBe('../images/a.png');
    expect(relativeMarkdownImagePath('C:\\Work\\docs', 'c:\\work\\a.png')).toBe('../a.png');
    expect(() => relativeMarkdownImagePath('C:\\work', 'D:\\images\\a.png')).toThrow(
      'relative path',
    );
  });

  it('resolves markdown sources and rejects unsafe schemes or paths', async () => {
    await expect(markdownImageUrl('https://example.com/a.png', null)).resolves.toBe(
      'https://example.com/a.png',
    );
    await expect(markdownImageUrl('./img/a.png?x=1', '/work/docs/a.md')).resolves.toBe(
      'asset:///work/docs/img/a.png',
    );
    for (const source of ['', 'data:image/png,a', 'javascript:alert(1)', '../../outside.png']) {
      await expect(markdownImageUrl(source, '/work/docs/a.md')).resolves.toBe('');
    }
    await expect(
      resolveMarkdownImagePath('../images/a.png?raw=1', '/work/docs/a.md'),
    ).resolves.toBe('/work/images/a.png');
    await expect(
      resolveMarkdownImagePath('https://example.com/a.png', '/work/docs/a.md'),
    ).resolves.toBeNull();
    await expect(resolveMarkdownImagePath('%zz.png', '/work/docs/a.md')).resolves.toBeNull();
  });
});
