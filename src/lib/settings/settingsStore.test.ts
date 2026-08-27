import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tauriMocks } from '../../test/tauriMocks';

describe('settings store', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    tauriMocks.exists.mockResolvedValue(false);
  });

  it('initializes defaults, updates CSS, debounces persistence, and flushes', async () => {
    const { flushSettings, initializeSettings, settingsActions, settingsStore } =
      await import('./settingsStore');
    await initializeSettings();
    settingsActions.updateAppearance({ uiFontSize: 19 });
    settingsActions.updateEditor({ maxWidth: null, wordWrap: false });
    settingsActions.updateFiles({ autoSave: true });
    expect(get(settingsStore)).toMatchObject({
      appearance: { uiFontSize: 19 },
      editor: { maxWidth: null, wordWrap: false },
      files: { autoSave: true },
    });
    expect(document.documentElement.style.getPropertyValue('--ui-font-size')).toBe('19px');
    expect(document.documentElement.style.getPropertyValue('--editor-max-width')).toBe('none');
    expect(document.documentElement.dataset.editorWordWrap).toBe('off');
    await vi.advanceTimersByTimeAsync(300);
    expect(tauriMocks.writeTextFile).toHaveBeenCalledTimes(1);

    settingsActions.reset();
    await flushSettings();
    expect(tauriMocks.writeTextFile).toHaveBeenCalledTimes(2);
  });

  it('normalizes persisted values and recovers from write failure', async () => {
    tauriMocks.exists.mockResolvedValue(true);
    tauriMocks.readTextFile.mockResolvedValue('{"appearance":{"uiFontSize":99}}');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { flushSettings, initializeSettings, settingsActions, settingsStore } =
      await import('./settingsStore');
    await initializeSettings();
    expect(get(settingsStore).appearance.uiFontSize).toBe(20);
    tauriMocks.writeTextFile.mockRejectedValueOnce(new Error('disk'));
    settingsActions.updateFiles({ autoSave: true });
    await flushSettings();
    expect(warn).toHaveBeenCalledWith('Could not persist settings.json.', expect.any(Error));
  });
});
