import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

const markdownFilters = [{ name: 'Markdown', extensions: ['md', 'markdown'] }];

export async function chooseMarkdownFile(): Promise<string | null> {
  const selected = await open({ multiple: false, directory: false, filters: markdownFilters });
  return selected;
}

export async function chooseSavePath(defaultPath?: string): Promise<string | null> {
  return save({ defaultPath: defaultPath ?? 'Sem título.md', filters: markdownFilters });
}

export async function readMarkdown(path: string): Promise<string> {
  const contents = await readTextFile(path);
  return contents.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export async function writeMarkdown(path: string, markdown: string): Promise<void> {
  const normalized = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  await writeTextFile(path, normalized);
}

export function fileName(path: string | null): string {
  if (!path) return 'Sem título.md';
  return path.split(/[\\/]/).pop() || 'Sem título.md';
}
