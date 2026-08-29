import { describe, expect, it } from 'vitest';
import {
  canDropInto,
  isDescendantPath,
  rewriteMovedPath,
  selectedOperationNodes,
  visibleNodes,
} from './explorerController';
import type { FileNode } from './workspaceService';

function node(path: string, isDirectory = false, children: FileNode[] = []): FileNode {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    isDirectory,
    type: isDirectory ? null : 'markdown',
    expanded: true,
    loading: false,
    loaded: true,
    children,
  };
}

describe('explorer controller', () => {
  const child = node('/work/docs/note.md');
  const folder = node('/work/docs', true, [child]);
  const image = { ...node('/work/photo.png'), type: 'image' as const };
  const entries = [folder, image];

  it('flattens visible nodes and removes descendants from batch operations', () => {
    expect(visibleNodes(entries).map(({ path }) => path)).toEqual([
      '/work/docs',
      '/work/docs/note.md',
      '/work/photo.png',
    ]);
    expect(selectedOperationNodes(entries, [folder.path, child.path])).toEqual([folder]);
  });

  it('validates drops without allowing folders inside themselves', () => {
    expect(canDropInto([folder], '/work/docs/child')).toBe(false);
    expect(canDropInto([folder], '/archive')).toBe(true);
    expect(canDropInto([image], '/work')).toBe(false);
    expect(isDescendantPath('C:\\Work', 'c:/work/docs/a.md')).toBe(true);
  });

  it('rewrites moved paths including descendants', () => {
    expect(
      rewriteMovedPath('/work/docs/note.md', [
        { path: '/work/docs', newPath: '/work/archive/docs', isDirectory: true },
      ]),
    ).toBe('/work/archive/docs/note.md');
  });
});
