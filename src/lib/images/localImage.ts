import { convertFileSrc } from '@tauri-apps/api/core';
import { dirname, join, normalize } from '@tauri-apps/api/path';
import { stat } from '@tauri-apps/plugin-fs';
import { get } from 'svelte/store';
import { sidebarState } from '../sidebar/sidebarStore';
import { isInsideWorkspace } from '../sidebar/workspace';
import { isImagePath } from './imageTypes';

export async function validateWorkspaceImagePath(path: string): Promise<string> {
  if (!isImagePath(path)) throw new Error('Formato de imagem não suportado.');
  const workspace = get(sidebarState).workspacePath;
  if (!workspace) throw new Error('Abra o workspace antes de visualizar imagens.');
  const normalizedPath = await normalize(path);
  if (!isInsideWorkspace(workspace, normalizedPath)) {
    throw new Error('Visualização recusada fora do workspace.');
  }
  const info = await stat(normalizedPath);
  if (!info.isFile) throw new Error('A imagem selecionada não é um arquivo válido.');
  return normalizedPath;
}

export async function workspaceImageUrl(path: string): Promise<string> {
  return convertFileSrc(await validateWorkspaceImagePath(path));
}

export async function markdownImageUrl(
  markdownSrc: string,
  documentPath: string | null,
): Promise<string> {
  if (/^https?:\/\//i.test(markdownSrc)) return markdownSrc;
  if (!markdownSrc || /^(?:data|blob|javascript):/i.test(markdownSrc)) return '';
  const workspace = get(sidebarState).workspacePath;
  if (!workspace) return '';
  const base = documentPath ? await dirname(documentPath) : workspace;
  const decoded = decodeURIComponent(markdownSrc.split(/[?#]/, 1)[0]);
  const absolutePath = await normalize(await join(base, decoded));
  if (!isInsideWorkspace(workspace, absolutePath) || !isImagePath(absolutePath)) return '';
  return convertFileSrc(absolutePath);
}
