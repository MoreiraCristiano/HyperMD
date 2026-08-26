import { open } from '@tauri-apps/plugin-dialog';
import { basename, join, normalize } from '@tauri-apps/api/path';
import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  stat,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import { fileExtension, isImagePath } from '../images/imageTypes';

export type WorkspaceFileType = 'markdown' | 'image';

export type FileNode = {
  name: string;
  path: string;
  isDirectory: boolean;
  type: WorkspaceFileType | null;
  expanded: boolean;
  loading: boolean;
  loaded: boolean;
  children: FileNode[];
};

export type SearchResult = {
  path: string;
  relativePath: string;
  snippet: string;
};

const MAX_SEARCH_RESULTS = 200;
const MAX_SEARCH_FILE_SIZE = 1024 * 1024;

export async function chooseWorkspace(): Promise<string | null> {
  return open({
    directory: true,
    multiple: false,
    recursive: true,
    title: 'Selecionar workspace',
  });
}

export function pathName(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || path
  );
}

function normalized(path: string): string {
  const value = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[A-Za-z]:/.test(value) ? value.toLowerCase() : value;
}

export function isInsideWorkspace(root: string, path: string): boolean {
  const normalizedRoot = normalized(root);
  const normalizedPath = normalized(path);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function assertInsideWorkspace(root: string, path: string): void {
  if (!isInsideWorkspace(root, path)) throw new Error('Operação recusada fora do workspace.');
}

function validateEntryName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..' || /[\\/]/.test(trimmed)) {
    throw new Error('Nome inválido. Não use caminhos ou separadores.');
  }
  if (trimmed.startsWith('.')) throw new Error('Arquivos ocultos não são suportados no Explorer.');
  return trimmed;
}

export function childPath(root: string, parent: string, name: string): string {
  assertInsideWorkspace(root, parent);
  const validName = validateEntryName(name);
  const separator = parent.includes('\\') && !parent.includes('/') ? '\\' : '/';
  const path = `${parent.replace(/[\\/]+$/, '')}${separator}${validName}`;
  assertInsideWorkspace(root, path);
  return path;
}

export function relativeWorkspacePath(root: string, path: string): string {
  assertInsideWorkspace(root, path);
  return normalized(path).slice(normalized(root).length).replace(/^\//, '');
}

function compareNodes(left: FileNode, right: FileNode): number {
  if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
}

export async function readWorkspaceDirectory(root: string, path: string): Promise<FileNode[]> {
  assertInsideWorkspace(root, path);
  const entries = await readDir(path);
  return entries
    .filter(
      (entry) =>
        !entry.name.startsWith('.') &&
        !entry.isSymlink &&
        (entry.isDirectory ||
          (entry.isFile && (entry.name.toLowerCase().endsWith('.md') || isImagePath(entry.name)))),
    )
    .map((entry): FileNode => ({
      name: entry.name,
      path: childPath(root, path, entry.name),
      isDirectory: entry.isDirectory,
      type: entry.isDirectory
        ? null
        : entry.name.toLowerCase().endsWith('.md')
          ? 'markdown'
          : 'image',
      expanded: false,
      loading: false,
      loaded: false,
      children: [],
    }))
    .sort(compareNodes);
}

export async function createMarkdownFile(
  root: string,
  parent: string,
  requestedName: string,
): Promise<string> {
  const name = requestedName.toLowerCase().endsWith('.md') ? requestedName : `${requestedName}.md`;
  const path = childPath(root, parent, name);
  if (await exists(path)) throw new Error('Já existe um item com esse nome.');
  await writeTextFile(path, '');
  return path;
}

export async function createWorkspaceFolder(
  root: string,
  parent: string,
  name: string,
): Promise<string> {
  const path = childPath(root, parent, name);
  if (await exists(path)) throw new Error('Já existe um item com esse nome.');
  await mkdir(path);
  return path;
}

export async function renameWorkspaceEntry(
  root: string,
  oldPath: string,
  requestedName: string,
  isDirectory: boolean,
  fileType: WorkspaceFileType | null,
): Promise<string> {
  assertInsideWorkspace(root, oldPath);
  let name = validateEntryName(requestedName);
  if (!isDirectory && fileType === 'markdown' && !name.toLowerCase().endsWith('.md')) name += '.md';
  if (!isDirectory && fileType === 'image') {
    const originalExtension = fileExtension(oldPath);
    const requestedExtension = fileExtension(name);
    if (!requestedExtension) name += `.${originalExtension}`;
    else if (requestedExtension !== originalExtension) {
      throw new Error('Renomear não converte imagens. Mantenha a extensão original.');
    }
  }
  const parent = oldPath.replace(/[\\/][^\\/]+$/, '');
  const newPath = childPath(root, parent, name);
  if (normalized(newPath) !== normalized(oldPath) && (await exists(newPath))) {
    throw new Error('Já existe um item com esse nome.');
  }
  await rename(oldPath, newPath);
  return newPath;
}

export async function moveWorkspaceEntry(
  root: string,
  oldPath: string,
  requestedDirectory: string,
): Promise<string> {
  assertInsideWorkspace(root, oldPath);
  const relativeDirectory = requestedDirectory.trim().replace(/\\/g, '/');
  if (relativeDirectory.split('/').some((part) => part === '..')) {
    throw new Error('Destino inválido. Não use “..”.');
  }
  const destination = await normalize(
    relativeDirectory && relativeDirectory !== '.' ? await join(root, relativeDirectory) : root,
  );
  assertInsideWorkspace(root, destination);
  const destinationInfo = await stat(destination);
  if (!destinationInfo.isDirectory) throw new Error('A pasta de destino não existe.');
  const target = await normalize(await join(destination, await basename(oldPath)));
  assertInsideWorkspace(root, target);
  if (normalized(target) === normalized(oldPath)) return oldPath;
  if (normalized(target).startsWith(`${normalized(oldPath)}/`)) {
    throw new Error('Não é possível mover uma pasta para dentro dela mesma.');
  }
  if (await exists(target)) throw new Error('Já existe um item com esse nome no destino.');
  await rename(oldPath, target);
  return target;
}

export async function removeWorkspaceEntry(
  root: string,
  path: string,
  isDirectory: boolean,
): Promise<void> {
  assertInsideWorkspace(root, path);
  if (normalized(root) === normalized(path)) throw new Error('Não é possível excluir o workspace.');
  await remove(path, { recursive: isDirectory });
}

export async function searchMarkdownFiles(
  root: string,
  query: string,
  isCurrent: () => boolean,
): Promise<SearchResult[]> {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const results: SearchResult[] = [];
  const pending = [root];

  while (pending.length && results.length < MAX_SEARCH_RESULTS && isCurrent()) {
    const directory = pending.pop()!;
    const entries = await readWorkspaceDirectory(root, directory);
    for (const entry of entries) {
      if (!isCurrent()) return results;
      if (entry.isDirectory) {
        pending.push(entry.path);
        continue;
      }

      if (entry.type !== 'markdown') continue;

      const info = await stat(entry.path);
      if (info.size > MAX_SEARCH_FILE_SIZE) continue;
      const content = await readTextFile(entry.path);
      const lowerContent = content.toLocaleLowerCase();
      const matchIndex = lowerContent.indexOf(needle);
      if (matchIndex === -1) continue;
      const lineStart = content.lastIndexOf('\n', matchIndex) + 1;
      const nextBreak = content.indexOf('\n', matchIndex);
      const lineEnd = nextBreak === -1 ? content.length : nextBreak;
      const line = content.slice(lineStart, lineEnd).trim();
      results.push({
        path: entry.path,
        relativePath: relativeWorkspacePath(root, entry.path),
        snippet: line.length > 120 ? `${line.slice(0, 117)}…` : line,
      });
      if (results.length >= MAX_SEARCH_RESULTS) break;
    }
  }

  return results;
}
