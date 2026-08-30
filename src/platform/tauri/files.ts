import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import {
  atomicWriteTextFile,
  conditionalAtomicWriteTextFile,
  readTextFileWithRevision,
  type ConditionalWriteResult,
  type FileRevisionExpectation,
  type RevisionedTextReadResult,
} from './atomicWrite';

const markdownFilters = [{ name: 'Markdown', extensions: ['md', 'markdown'] }];

export async function chooseMarkdownFile(): Promise<string | null> {
  const selected = await open({ multiple: false, directory: false, filters: markdownFilters });
  return selected;
}

export async function chooseSavePath(defaultPath?: string): Promise<string | null> {
  return save({ defaultPath: defaultPath ?? 'Untitled.md', filters: markdownFilters });
}

export async function readMarkdown(path: string): Promise<string> {
  const result = await readMarkdownWithRevision(path);
  if (result.status === 'io-error') throw new Error(result.message);
  const contents = result.contents;
  return contents.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export async function readMarkdownWithRevision(path: string): Promise<RevisionedTextReadResult> {
  return readTextFileWithRevision(path);
}

export async function readMarkdownSource(path: string): Promise<string> {
  return readTextFile(path);
}

export async function writeMarkdown(path: string, markdown: string): Promise<void> {
  const normalized = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  await atomicWriteTextFile(path, normalized);
}

export async function writeMarkdownConditionally(
  path: string,
  markdown: string,
  expected: FileRevisionExpectation,
): Promise<ConditionalWriteResult> {
  const normalized = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return conditionalAtomicWriteTextFile(path, normalized, expected);
}

export async function writeMarkdownSourceConditionally(
  path: string,
  contents: string,
  expected: FileRevisionExpectation,
): Promise<ConditionalWriteResult> {
  return conditionalAtomicWriteTextFile(path, contents, expected);
}

export async function restoreMarkdownSource(path: string, markdown: string): Promise<void> {
  await atomicWriteTextFile(path, markdown);
}

export function fileName(path: string | null): string {
  if (!path) return 'Untitled.md';
  return path.split(/[\\/]/).pop() || 'Untitled.md';
}
