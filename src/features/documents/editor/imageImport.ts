import { dirname, join, normalize } from '@/platform/tauri/path';
import { exists, open, remove } from '@/platform/tauri/filesystem';
import { isInsideWorkspace } from '@/features/workspace';
import { relativeMarkdownImagePath } from '../images/localImage';

const MAX_IMAGE_SIZE = 50 * 1024 * 1024;
const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
};

export type ImportedImage = {
  absolutePath: string;
  markdownSrc: string;
};

export function isSupportedImageMime(mime: string): boolean {
  return Object.hasOwn(MIME_EXTENSIONS, mime.toLowerCase());
}

function timestamp(date: Date): string {
  const part = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${part(date.getMonth() + 1)}${part(date.getDate())}-${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}`;
}

export async function saveClipboardImage(
  blob: Blob,
  workspaceRoot: string,
  documentPath: string | null,
): Promise<ImportedImage> {
  const mime = blob.type.toLowerCase();
  const extension = MIME_EXTENSIONS[mime];
  if (!extension) throw new Error(`Unsupported image format: ${mime || 'unknown'}.`);
  if (blob.size === 0) throw new Error('The clipboard image is empty.');
  if (blob.size > MAX_IMAGE_SIZE) throw new Error('The image exceeds the 50 MB limit.');

  const root = await normalize(workspaceRoot);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const baseName = `pasted-image-${timestamp(new Date())}`;

  for (let index = 1; index <= 999; index += 1) {
    const suffix = index === 1 ? '' : `-${index}`;
    const filename = `${baseName}${suffix}.${extension}`;
    const absolutePath = await normalize(await join(root, filename));
    if (!isInsideWorkspace(root, absolutePath)) {
      throw new Error('Operation denied outside the workspace.');
    }

    let file;
    try {
      file = await open(absolutePath, { write: true, createNew: true });
    } catch (cause) {
      if (await exists(absolutePath)) continue;
      throw cause;
    }

    let failure: unknown;
    try {
      let written = 0;
      while (written < bytes.byteLength) {
        const count = await file.write(bytes.subarray(written));
        if (count === 0) throw new Error('Writing the image was interrupted.');
        written += count;
      }
    } catch (cause) {
      failure = cause;
    } finally {
      await file.close();
    }
    if (failure) {
      await remove(absolutePath).catch(() => {});
      throw new Error('Could not write the image to the workspace.', { cause: failure });
    }

    const documentDirectory = documentPath ? await dirname(documentPath) : root;
    return {
      absolutePath,
      markdownSrc: relativeMarkdownImagePath(await normalize(documentDirectory), absolutePath),
    };
  }

  throw new Error('Could not generate an available image name.');
}
