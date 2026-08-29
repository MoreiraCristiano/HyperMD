import { beforeEach, describe, expect, it } from 'vitest';
import { tauriMocks } from '@/test/tauriMocks';
import { chooseMarkdownFile, chooseSavePath, fileName, readMarkdown, writeMarkdown } from './files';

describe('files', () => {
  beforeEach(() => {
    tauriMocks.dialogOpen.mockResolvedValue(null);
    tauriMocks.dialogSave.mockResolvedValue(null);
  });

  it('uses Markdown filters for open and save dialogs', async () => {
    tauriMocks.dialogOpen.mockResolvedValue('/notes/a.md');
    tauriMocks.dialogSave.mockResolvedValue('/notes/b.md');
    await expect(chooseMarkdownFile()).resolves.toBe('/notes/a.md');
    await expect(chooseSavePath()).resolves.toBe('/notes/b.md');
    expect(tauriMocks.dialogOpen).toHaveBeenCalledWith(
      expect.objectContaining({ multiple: false, directory: false }),
    );
    expect(tauriMocks.dialogSave).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'Untitled.md' }),
    );
    await chooseSavePath('/notes/a.md');
    expect(tauriMocks.dialogSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ defaultPath: '/notes/a.md' }),
    );
  });

  it('normalizes line endings on reads and writes', async () => {
    tauriMocks.readTextFile.mockResolvedValue('a\r\nb\rc');
    await expect(readMarkdown('/a.md')).resolves.toBe('a\nb\nc');
    await writeMarkdown('/a.md', 'a\r\nb\rc');
    expect(tauriMocks.writeTextFile).toHaveBeenCalledWith('/a.md', 'a\nb\nc');
  });

  it('derives safe display names', () => {
    expect(fileName('C:\\notes\\one.md')).toBe('one.md');
    expect(fileName('/notes/two.md')).toBe('two.md');
    expect(fileName(null)).toBe('Untitled.md');
    expect(fileName('/')).toBe('Untitled.md');
  });
});
