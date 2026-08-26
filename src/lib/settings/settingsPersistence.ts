import { BaseDirectory } from '@tauri-apps/api/path';
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import type { AppSettings } from './settingsTypes';

const SETTINGS_FILE = 'settings.json';
const OPTIONS = { baseDir: BaseDirectory.AppConfig } as const;

export async function readPersistedSettings(): Promise<unknown | null> {
  try {
    if (!(await exists(SETTINGS_FILE, OPTIONS))) return null;
    return JSON.parse(await readTextFile(SETTINGS_FILE, OPTIONS));
  } catch (error) {
    console.warn('Não foi possível carregar settings.json; usando valores padrão.', error);
    return null;
  }
}

export async function writePersistedSettings(settings: AppSettings): Promise<void> {
  await mkdir('.', { ...OPTIONS, recursive: true });
  await writeTextFile(SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`, OPTIONS);
}
