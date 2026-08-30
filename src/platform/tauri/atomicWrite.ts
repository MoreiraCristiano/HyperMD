import { invoke } from '@tauri-apps/api/core';
import type { BaseDirectory } from '@tauri-apps/api/path';

type AtomicWriteOptions = {
  baseDir?: BaseDirectory;
};

export type FileRevisionExpectation =
  { state: 'revision'; revision: string } | { state: 'missing' } | { state: 'any' };

export type FileConflictKind = 'changed' | 'missing' | 'exists';

export type ConditionalWriteResult =
  | { status: 'success'; revision: string }
  | { status: 'conflict'; kind: FileConflictKind; actualRevision: string | null }
  | { status: 'io-error'; operation: string; message: string };

export type RevisionedTextReadResult =
  | { status: 'success'; contents: string; revision: string }
  | { status: 'io-error'; operation: string; message: string };

export type ConditionalRenameResult =
  | { status: 'success'; revision: string }
  | {
      status: 'conflict';
      path: 'source' | 'destination';
      kind: FileConflictKind;
      actualRevision: string | null;
    }
  | { status: 'io-error'; operation: string; message: string };

export async function atomicWriteTextFile(
  path: string,
  contents: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  await invoke('atomic_write_text', { path, contents, baseDir: options.baseDir });
}

function invocationError(
  operation: string,
  cause: unknown,
): Extract<ConditionalWriteResult, { status: 'io-error' }> {
  return {
    status: 'io-error',
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
  };
}

export async function readTextFileWithRevision(path: string): Promise<RevisionedTextReadResult> {
  try {
    return await invoke<RevisionedTextReadResult>('read_text_with_revision', { path });
  } catch (cause) {
    const failure = invocationError('invoke-read', cause);
    return { status: 'io-error', operation: failure.operation, message: failure.message };
  }
}

export async function conditionalAtomicWriteTextFile(
  path: string,
  contents: string,
  expected: FileRevisionExpectation,
): Promise<ConditionalWriteResult> {
  try {
    return await invoke<ConditionalWriteResult>('conditional_atomic_write_text', {
      path,
      contents,
      expected,
    });
  } catch (cause) {
    return invocationError('invoke-write', cause);
  }
}

export async function readFileRevision(path: string): Promise<RevisionedTextReadResult> {
  try {
    return await invoke<RevisionedTextReadResult>('read_file_revision', { path });
  } catch (cause) {
    const failure = invocationError('invoke-read-revision', cause);
    return { status: 'io-error', operation: failure.operation, message: failure.message };
  }
}

export async function conditionalRenameFile(
  source: string,
  destination: string,
  sourceRevision: string,
): Promise<ConditionalRenameResult> {
  try {
    return await invoke<ConditionalRenameResult>('conditional_rename_file', {
      source,
      destination,
      sourceRevision,
    });
  } catch (cause) {
    return invocationError('invoke-rename', cause);
  }
}
