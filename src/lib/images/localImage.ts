import { convertFileSrc } from '@tauri-apps/api/core';
import { dirname, join, normalize } from '@tauri-apps/api/path';
import { stat } from '@tauri-apps/plugin-fs';
import { get } from 'svelte/store';
import { sidebarState } from '../sidebar/sidebarStore';
import { isInsideWorkspace } from '../sidebar/workspace';
import { isImagePath } from './imageTypes';

export function relativeMarkdownImagePath(fromDirectory: string, target: string): string {
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
  if (common === 0) throw new Error('Could not create a relative path for the image.');
  const parts = [...Array(from.length - common).fill('..'), ...to.slice(common)];
  const relative = parts.join('/');
  return relative.startsWith('../') ? relative : `./${relative}`;
}

export async function validateWorkspaceImagePath(path: string): Promise<string> {
  if (!isImagePath(path)) throw new Error('Unsupported image format.');
  const workspace = get(sidebarState).workspacePath;
  if (!workspace) throw new Error('Open the workspace before viewing images.');
  const normalizedPath = await normalize(path);
  if (!isInsideWorkspace(workspace, normalizedPath)) {
    throw new Error('Viewing files outside the workspace is not allowed.');
  }
  const info = await stat(normalizedPath);
  if (!info.isFile) throw new Error('The selected image is not a valid file.');
  return normalizedPath;
}

export async function workspaceImageUrl(path: string): Promise<string> {
  return convertFileSrc(await validateWorkspaceImagePath(path));
}

export async function resolveMarkdownImagePath(
  markdownSrc: string,
  documentPath: string | null,
): Promise<string | null> {
  if (/^https?:\/\//i.test(markdownSrc)) return null;
  if (!markdownSrc || /^(?:data|blob|javascript):/i.test(markdownSrc)) return null;
  const workspace = get(sidebarState).workspacePath;
  if (!workspace) return null;
  const base = documentPath ? await dirname(documentPath) : workspace;
  let decoded: string;
  try {
    decoded = decodeURIComponent(markdownSrc.split(/[?#]/, 1)[0]);
  } catch {
    return null;
  }
  const absolutePath = await normalize(await join(base, decoded));
  if (!isInsideWorkspace(workspace, absolutePath) || !isImagePath(absolutePath)) return null;
  return absolutePath;
}

export async function markdownImageUrl(
  markdownSrc: string,
  documentPath: string | null,
): Promise<string> {
  if (/^https?:\/\//i.test(markdownSrc)) return markdownSrc;
  const absolutePath = await resolveMarkdownImagePath(markdownSrc, documentPath);
  return absolutePath ? convertFileSrc(absolutePath) : '';
}
