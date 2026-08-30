import { vi } from 'vitest';

const tauriMocks = vi.hoisted(() => {
  const atomicWriteTextFile = vi.fn();
  const mocks = {
    dialogOpen: vi.fn(),
    dialogSave: vi.fn(),
    clipboardReadText: vi.fn(),
    clipboardWriteText: vi.fn(),
    readTextFile: vi.fn(),
    writeTextFile: vi.fn(),
    atomicWriteTextFile,
    conditionalAtomicWriteTextFile: vi.fn(),
    conditionalRenameFile: vi.fn(),
    invoke: vi.fn(),
    exists: vi.fn(),
    mkdir: vi.fn(),
    readDir: vi.fn(),
    remove: vi.fn(),
    rename: vi.fn(),
    stat: vi.fn(),
    openFile: vi.fn(),
    convertFileSrc: vi.fn((path: string) => `asset://${path}`),
    openUrl: vi.fn(),
    getCurrentWindow: vi.fn(),
    getCurrentWebview: vi.fn(),
  };
  mocks.invoke.mockImplementation(
    async (
      command: string,
      args: {
        path?: string;
        source?: string;
        destination?: string;
        sourceRevision?: string;
        contents?: string;
        baseDir?: number;
        expected?: { state: string; revision?: string };
      },
    ) => {
      if (command === 'atomic_write_text') {
        return args.baseDir === undefined
          ? atomicWriteTextFile(args.path, args.contents)
          : atomicWriteTextFile(args.path, args.contents, args.baseDir);
      }
      if (command === 'read_text_with_revision') {
        const contents = await mocks.readTextFile(args.path);
        return { status: 'success', contents, revision: `revision:${contents}` };
      }
      if (command === 'conditional_atomic_write_text') {
        return mocks.conditionalAtomicWriteTextFile(args.path, args.contents, args.expected);
      }
      if (command === 'read_file_revision') {
        return { status: 'success', contents: '', revision: `revision:${args.path}` };
      }
      if (command === 'conditional_rename_file') {
        return mocks.conditionalRenameFile(args.source, args.destination, args.sourceRevision);
      }
      throw new Error(`Unexpected command: ${command}`);
    },
  );
  return mocks;
});

function slash(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
}

function normalizedPath(path: string): string {
  const value = slash(path);
  const drive = value.match(/^[A-Za-z]:/)?.[0] ?? '';
  const absolute = value.startsWith('/') || Boolean(drive);
  const parts = value.replace(/^[A-Za-z]:/, '').split('/');
  const result: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') result.pop();
    else result.push(part);
  }
  return `${drive}${absolute ? '/' : ''}${result.join('/')}` || (absolute ? '/' : '.');
}

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: tauriMocks.dialogOpen,
  save: tauriMocks.dialogSave,
}));

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  readText: tauriMocks.clipboardReadText,
  writeText: tauriMocks.clipboardWriteText,
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: tauriMocks.readTextFile,
  writeTextFile: tauriMocks.writeTextFile,
  exists: tauriMocks.exists,
  mkdir: tauriMocks.mkdir,
  readDir: tauriMocks.readDir,
  remove: tauriMocks.remove,
  rename: tauriMocks.rename,
  stat: tauriMocks.stat,
  open: tauriMocks.openFile,
}));

vi.mock('@tauri-apps/api/path', () => ({
  normalize: vi.fn(async (path: string) => normalizedPath(path)),
  join: vi.fn(async (...parts: string[]) => normalizedPath(parts.join('/'))),
  dirname: vi.fn(async (path: string) => slash(path).replace(/\/[^/]*$/, '') || '/'),
  basename: vi.fn(async (path: string) => slash(path).replace(/\/$/, '').split('/').pop() ?? ''),
  BaseDirectory: { AppConfig: 13 },
}));

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: tauriMocks.convertFileSrc,
  invoke: tauriMocks.invoke,
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: tauriMocks.openUrl }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: tauriMocks.getCurrentWindow }));
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: tauriMocks.getCurrentWebview }));

export function resetTauriMocks(): void {
  for (const mock of Object.values(tauriMocks)) {
    if ('mockReset' in mock) mock.mockReset();
  }
  tauriMocks.convertFileSrc.mockImplementation((path: string) => `asset://${path}`);
  tauriMocks.invoke.mockImplementation(
    async (
      command: string,
      args: {
        path?: string;
        source?: string;
        destination?: string;
        sourceRevision?: string;
        contents?: string;
        baseDir?: number;
        expected?: { state: string; revision?: string };
      },
    ) => {
      if (command === 'atomic_write_text') {
        return args.baseDir === undefined
          ? tauriMocks.atomicWriteTextFile(args.path, args.contents)
          : tauriMocks.atomicWriteTextFile(args.path, args.contents, args.baseDir);
      }
      if (command === 'read_text_with_revision') {
        try {
          const contents = await tauriMocks.readTextFile(args.path);
          return { status: 'success', contents, revision: `revision:${contents}` };
        } catch (cause) {
          return { status: 'io-error', operation: 'read', message: String(cause) };
        }
      }
      if (command === 'conditional_atomic_write_text') {
        return tauriMocks.conditionalAtomicWriteTextFile(args.path, args.contents, args.expected);
      }
      if (command === 'read_file_revision') {
        return { status: 'success', contents: '', revision: `revision:${args.path}` };
      }
      if (command === 'conditional_rename_file') {
        return tauriMocks.conditionalRenameFile(args.source, args.destination, args.sourceRevision);
      }
      throw new Error(`Unexpected command: ${command}`);
    },
  );
  tauriMocks.remove.mockResolvedValue(undefined);
  tauriMocks.rename.mockResolvedValue(undefined);
  tauriMocks.mkdir.mockResolvedValue(undefined);
  tauriMocks.writeTextFile.mockResolvedValue(undefined);
  tauriMocks.atomicWriteTextFile.mockResolvedValue(undefined);
  tauriMocks.conditionalAtomicWriteTextFile.mockImplementation(
    async (path: string, contents: string) => {
      await tauriMocks.atomicWriteTextFile(path, contents);
      return { status: 'success', revision: `revision:${contents}` };
    },
  );
  tauriMocks.conditionalRenameFile.mockImplementation(
    async (source: string, destination: string, sourceRevision: string) => {
      await tauriMocks.rename(source, destination);
      return { status: 'success', revision: sourceRevision };
    },
  );
  tauriMocks.clipboardWriteText.mockResolvedValue(undefined);
  tauriMocks.openUrl.mockResolvedValue(undefined);
}

export { tauriMocks };
