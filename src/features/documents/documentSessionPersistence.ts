import { atomicWriteTextFile } from '@/platform/tauri/atomicWrite';
import { exists, mkdir, readTextFile } from '@/platform/tauri/filesystem';
import { BaseDirectory } from '@/platform/tauri/path';

export const DOCUMENT_SESSION_FILE = 'session-v2.json';
const OPTIONS = { baseDir: BaseDirectory.AppConfig } as const;

export async function readPersistedDocumentSession(): Promise<unknown | null> {
  try {
    if (!(await exists(DOCUMENT_SESSION_FILE, OPTIONS))) return null;
    return JSON.parse(await readTextFile(DOCUMENT_SESSION_FILE, OPTIONS));
  } catch (error) {
    console.warn('Could not load session-v2.json.', error);
    return null;
  }
}

export async function writePersistedDocumentSession(session: unknown): Promise<void> {
  await mkdir('.', { ...OPTIONS, recursive: true });
  await atomicWriteTextFile(
    DOCUMENT_SESSION_FILE,
    `${JSON.stringify(session, null, 2)}\n`,
    OPTIONS,
  );
}
