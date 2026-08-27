import { get, writable } from 'svelte/store';
import { readPersistedSettings, writePersistedSettings } from './settingsPersistence';
import { cloneDefaultSettings, normalizeSettings, type AppSettings } from './settingsTypes';

export const settingsStore = writable<AppSettings>(cloneDefaultSettings());

let persistTimer: ReturnType<typeof setTimeout> | undefined;
let persistChain = Promise.resolve();
let initialized = false;

function applyCssVariables(settings: AppSettings): void {
  const root = document.documentElement;
  root.style.setProperty(
    '--ui-font-family',
    `${settings.appearance.uiFontFamily}, "Segoe UI", sans-serif`,
  );
  root.style.setProperty('--ui-font-size', `${settings.appearance.uiFontSize}px`);
  root.style.setProperty(
    '--editor-font-family',
    `${settings.editor.fontFamily}, "Segoe UI", sans-serif`,
  );
  root.style.setProperty(
    '--code-block-font-family',
    `${settings.editor.codeBlockFontFamily}, Consolas, monospace`,
  );
  root.style.setProperty('--editor-font-size', `${settings.editor.fontSize}px`);
  root.style.setProperty('--editor-line-height', String(settings.editor.lineHeight));
  root.style.setProperty(
    '--editor-max-width',
    settings.editor.maxWidth === null ? 'none' : `${settings.editor.maxWidth}px`,
  );
  root.dataset.editorWordWrap = settings.editor.wordWrap ? 'on' : 'off';
}

function queuePersist(delay = 300): void {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    const snapshot = get(settingsStore);
    persistChain = persistChain
      .then(() => writePersistedSettings(snapshot))
      .catch((error) => console.warn('Could not persist settings.json.', error));
  }, delay);
}

function commit(settings: AppSettings, persist = true): void {
  const normalized = normalizeSettings(settings);
  settingsStore.set(normalized);
  applyCssVariables(normalized);
  if (persist && initialized) queuePersist();
}

export async function initializeSettings(): Promise<void> {
  const persisted = await readPersistedSettings();
  commit(normalizeSettings(persisted), false);
  initialized = true;
}

export async function flushSettings(): Promise<void> {
  clearTimeout(persistTimer);
  persistTimer = undefined;
  const snapshot = get(settingsStore);
  persistChain = persistChain
    .catch(() => undefined)
    .then(() => writePersistedSettings(snapshot))
    .catch((error) => console.warn('Could not persist settings.json.', error));
  await persistChain;
}

export const settingsActions = {
  updateAppearance(patch: Partial<AppSettings['appearance']>): void {
    const current = get(settingsStore);
    commit({ ...current, appearance: { ...current.appearance, ...patch } });
  },
  updateEditor(patch: Partial<AppSettings['editor']>): void {
    const current = get(settingsStore);
    commit({ ...current, editor: { ...current.editor, ...patch } });
  },
  updateFiles(patch: Partial<AppSettings['files']>): void {
    const current = get(settingsStore);
    commit({ ...current, files: { ...current.files, ...patch } });
  },
  reset(): void {
    commit(cloneDefaultSettings());
  },
};
