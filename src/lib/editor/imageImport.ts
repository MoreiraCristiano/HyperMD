import { dirname, join, normalize } from '@tauri-apps/api/path';
import { exists, open, remove } from '@tauri-apps/plugin-fs';
import { isInsideWorkspace } from '../sidebar/workspace';

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

function markdownRelativePath(fromDirectory: string, target: string): string {
  const from = fromDirectory.replace(/\\/g, '/').replace(/\/$/, '').split('/');
  const to = target.replace(/\\/g, '/').replace(/\/$/, '').split('/');
  const caseInsensitive = /^[A-Za-z]:$/.test(from[0] ?? '') && /^[A-Za-z]:$/.test(to[0] ?? '');
  let common = 0;
  while (
    common < from.length &&
    common < to.length &&
    (caseInsensitive
      ? from[common].toLowerCase() === to[common].toLowerCase()
      : from[common] === to[common])
  ) {
    common += 1;
  }
  if (common === 0) throw new Error('Não foi possível criar um caminho relativo para a imagem.');
  const parts = [...Array(from.length - common).fill('..'), ...to.slice(common)];
  const relative = parts.join('/');
  return relative.startsWith('../') ? relative : `./${relative}`;
}

export async function saveClipboardImage(
  blob: Blob,
  workspaceRoot: string,
  documentPath: string | null,
): Promise<ImportedImage> {
  const mime = blob.type.toLowerCase();
  const extension = MIME_EXTENSIONS[mime];
  if (!extension) throw new Error(`Formato de imagem não suportado: ${mime || 'desconhecido'}.`);
  if (blob.size === 0) throw new Error('A imagem do clipboard está vazia.');
  if (blob.size > MAX_IMAGE_SIZE) throw new Error('A imagem excede o limite de 50 MB.');

  const root = await normalize(workspaceRoot);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const baseName = `pasted-image-${timestamp(new Date())}`;

  for (let index = 1; index <= 999; index += 1) {
    const suffix = index === 1 ? '' : `-${index}`;
    const filename = `${baseName}${suffix}.${extension}`;
    const absolutePath = await normalize(await join(root, filename));
    if (!isInsideWorkspace(root, absolutePath)) {
      throw new Error('Operação recusada fora do workspace.');
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
        if (count === 0) throw new Error('A gravação da imagem foi interrompida.');
        written += count;
      }
    } catch (cause) {
      failure = cause;
    } finally {
      await file.close();
    }
    if (failure) {
      await remove(absolutePath).catch(() => {});
      throw new Error('Não foi possível gravar a imagem no workspace.', { cause: failure });
    }

    const documentDirectory = documentPath ? await dirname(documentPath) : root;
    return {
      absolutePath,
      markdownSrc: markdownRelativePath(await normalize(documentDirectory), absolutePath),
    };
  }

  throw new Error('Não foi possível gerar um nome livre para a imagem.');
}
