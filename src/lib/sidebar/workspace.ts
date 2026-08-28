import { open } from '@tauri-apps/plugin-dialog';
import { basename, join, normalize } from '@tauri-apps/api/path';
import { exists, mkdir, readDir, remove, rename, stat, writeTextFile } from '@tauri-apps/plugin-fs';
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

export type WorkspaceEntryRef = {
  path: string;
  isDirectory: boolean;
};

export type WorkspaceMove = WorkspaceEntryRef & {
  newPath: string;
};

export type WorkspaceMoveBatchResult = {
  moved: WorkspaceMove[];
  error: unknown | null;
};

export async function chooseWorkspace(): Promise<string | null> {
  return open({
    directory: true,
    multiple: false,
    recursive: true,
    title: 'Select Workspace',
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
  if (!isInsideWorkspace(root, path)) throw new Error('Operation denied outside the workspace.');
}

function validateEntryName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..' || /[\\/]/.test(trimmed)) {
    throw new Error('Invalid name. Do not use paths or separators.');
  }
  if (trimmed.startsWith('.')) throw new Error('Hidden files are not supported in Explorer.');
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

export async function listWorkspaceMarkdownFiles(
  root: string,
  directory = root,
): Promise<string[]> {
  const files: string[] = [];
  for (const node of await readWorkspaceDirectory(root, directory)) {
    if (node.isDirectory) files.push(...(await listWorkspaceMarkdownFiles(root, node.path)));
    else if (node.type === 'markdown') files.push(node.path);
  }
  return files;
}

export async function createMarkdownFile(
  root: string,
  parent: string,
  requestedName: string,
): Promise<string> {
  const name = requestedName.toLowerCase().endsWith('.md') ? requestedName : `${requestedName}.md`;
  const path = childPath(root, parent, name);
  if (await exists(path)) throw new Error('An item with this name already exists.');
  await writeTextFile(path, '');
  return path;
}

export async function createWorkspaceFolder(
  root: string,
  parent: string,
  name: string,
): Promise<string> {
  const path = childPath(root, parent, name);
  if (await exists(path)) throw new Error('An item with this name already exists.');
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
      throw new Error('Renaming does not convert images. Keep the original extension.');
    }
  }
  const parent = oldPath.replace(/[\\/][^\\/]+$/, '');
  const newPath = childPath(root, parent, name);
  if (normalized(newPath) !== normalized(oldPath) && (await exists(newPath))) {
    throw new Error('An item with this name already exists.');
  }
  await rename(oldPath, newPath);
  return newPath;
}

export async function moveWorkspaceEntry(
  root: string,
  oldPath: string,
  requestedDirectory: string,
): Promise<string> {
  const result = await moveWorkspaceEntries(
    root,
    [{ path: oldPath, isDirectory: false }],
    requestedDirectory,
  );
  if (result.error) throw result.error;
  return result.moved[0]?.newPath ?? oldPath;
}

export async function moveWorkspaceEntries(
  root: string,
  entries: readonly WorkspaceEntryRef[],
  requestedDirectory: string,
): Promise<WorkspaceMoveBatchResult> {
  const relativeDirectory = requestedDirectory.trim().replace(/\\/g, '/');
  if (relativeDirectory.split('/').some((part) => part === '..')) {
    throw new Error('Invalid destination. Do not use “..”.');
  }
  const destination = await normalize(
    relativeDirectory && relativeDirectory !== '.' ? await join(root, relativeDirectory) : root,
  );
  assertInsideWorkspace(root, destination);
  const destinationInfo = await stat(destination);
  if (!destinationInfo.isDirectory) throw new Error('The destination folder does not exist.');

  const plans: WorkspaceMove[] = [];
  const targets = new Set<string>();
  for (const entry of entries) {
    assertInsideWorkspace(root, entry.path);
    const target = await normalize(await join(destination, await basename(entry.path)));
    assertInsideWorkspace(root, target);
    if (normalized(target) === normalized(entry.path)) continue;
    if (normalized(target).startsWith(`${normalized(entry.path)}/`)) {
      throw new Error('A folder cannot be moved inside itself.');
    }
    const targetKey = normalized(target);
    if (targets.has(targetKey)) {
      throw new Error('Multiple selected items have the same name at the destination.');
    }
    if (await exists(target)) {
      throw new Error('An item with this name already exists at the destination.');
    }
    targets.add(targetKey);
    plans.push({ ...entry, newPath: target });
  }

  const moved: WorkspaceMove[] = [];
  for (const plan of plans) {
    try {
      await rename(plan.path, plan.newPath);
      moved.push(plan);
    } catch (error) {
      return { moved, error };
    }
  }
  return { moved, error: null };
}

export async function removeWorkspaceEntry(
  root: string,
  path: string,
  isDirectory: boolean,
): Promise<void> {
  assertInsideWorkspace(root, path);
  if (normalized(root) === normalized(path)) throw new Error('The workspace cannot be deleted.');
  await remove(path, { recursive: isDirectory });
}
