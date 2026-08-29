import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tauriMocks } from '@/test/tauriMocks';
import { isSupportedImageMime, saveClipboardImage } from './imageImport';

describe('clipboard image import', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 2, 3, 4, 5));
    tauriMocks.exists.mockResolvedValue(false);
  });

  it('recognizes supported MIME types and validates blobs', async () => {
    expect(isSupportedImageMime('IMAGE/PNG')).toBe(true);
    expect(isSupportedImageMime('image/svg+xml')).toBe(false);
    await expect(
      saveClipboardImage(new Blob([], { type: 'image/png' }), '/work', null),
    ).rejects.toThrow('empty');
    await expect(
      saveClipboardImage(new Blob(['x'], { type: 'text/plain' }), '/work', null),
    ).rejects.toThrow('Unsupported image format');
  });

  it('writes all bytes and creates a relative Markdown source', async () => {
    const file = {
      write: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2),
      close: vi.fn().mockResolvedValue(undefined),
    };
    tauriMocks.openFile.mockResolvedValue(file);
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    await expect(saveClipboardImage(blob, '/work', '/work/docs/a.md')).resolves.toEqual({
      absolutePath: '/work/pasted-image-20260102-030405.png',
      markdownSrc: '../pasted-image-20260102-030405.png',
    });
    expect(file.write).toHaveBeenCalledTimes(2);
    expect(file.close).toHaveBeenCalled();
  });

  it('retries collisions and removes partial files after write failure', async () => {
    const successful = { write: vi.fn().mockResolvedValue(1), close: vi.fn() };
    tauriMocks.openFile
      .mockRejectedValueOnce(new Error('exists'))
      .mockResolvedValueOnce(successful);
    tauriMocks.exists.mockResolvedValueOnce(true);
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    const imported = await saveClipboardImage(blob, '/work', null);
    expect(imported.absolutePath).toContain('-2.jpg');

    const broken = { write: vi.fn().mockRejectedValue(new Error('disk')), close: vi.fn() };
    tauriMocks.openFile.mockReset().mockResolvedValue(broken);
    await expect(saveClipboardImage(blob, '/work', null)).rejects.toThrow('Could not write');
    expect(tauriMocks.remove).toHaveBeenCalled();
  });

  it('rejects oversized and untyped clipboard images', async () => {
    const oversized = new Blob(['x'], { type: 'image/png' });
    Object.defineProperty(oversized, 'size', { value: 50 * 1024 * 1024 + 1 });
    await expect(saveClipboardImage(oversized, '/work', null)).rejects.toThrow('50 MB');
    await expect(saveClipboardImage(new Blob(['x']), '/work', null)).rejects.toThrow('unknown');
  });

  it('propagates open failures and detects interrupted writes', async () => {
    const blob = new Blob(['x'], { type: 'image/webp' });
    tauriMocks.openFile.mockRejectedValueOnce(new Error('permission denied'));
    tauriMocks.exists.mockResolvedValueOnce(false);
    await expect(saveClipboardImage(blob, '/work', null)).rejects.toThrow('permission denied');

    const interrupted = { write: vi.fn().mockResolvedValue(0), close: vi.fn() };
    tauriMocks.openFile.mockResolvedValueOnce(interrupted);
    tauriMocks.remove.mockRejectedValueOnce(new Error('cleanup failed'));
    await expect(saveClipboardImage(blob, '/work', null)).rejects.toThrow('Could not write');
    expect(interrupted.close).toHaveBeenCalled();
  });

  it('creates case-insensitive Windows relative paths and rejects different roots', async () => {
    const file = { write: vi.fn().mockResolvedValue(1), close: vi.fn() };
    tauriMocks.openFile.mockResolvedValue(file);
    const blob = new Blob(['x'], { type: 'image/gif' });
    await expect(
      saveClipboardImage(blob, 'C:\\Work', 'c:\\work\\docs\\a.md'),
    ).resolves.toMatchObject({
      markdownSrc: '../pasted-image-20260102-030405.gif',
    });
    await expect(saveClipboardImage(blob, 'C:\\Work', 'D:\\docs\\a.md')).rejects.toThrow(
      'relative path',
    );
  });
});
