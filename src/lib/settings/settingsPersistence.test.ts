import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tauriMocks } from '../../test/tauriMocks';
import { readPersistedSettings, writePersistedSettings } from './settingsPersistence';
import { cloneDefaultSettings } from './settingsTypes';

describe('settings persistence', () => {
  beforeEach(() => tauriMocks.exists.mockResolvedValue(false));

  it('returns null when file is absent or unreadable', async () => {
    await expect(readPersistedSettings()).resolves.toBeNull();
    tauriMocks.exists.mockResolvedValue(true);
    tauriMocks.readTextFile.mockResolvedValue('{invalid');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(readPersistedSettings()).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('parses and writes formatted settings in app config', async () => {
    tauriMocks.exists.mockResolvedValue(true);
    tauriMocks.readTextFile.mockResolvedValue('{"files":{"autoSave":true}}');
    await expect(readPersistedSettings()).resolves.toEqual({ files: { autoSave: true } });
    const settings = cloneDefaultSettings();
    await writePersistedSettings(settings);
    expect(tauriMocks.mkdir).toHaveBeenCalledWith(
      '.',
      expect.objectContaining({ recursive: true }),
    );
    expect(tauriMocks.writeTextFile).toHaveBeenCalledWith(
      'settings.json',
      `${JSON.stringify(settings, null, 2)}\n`,
      expect.any(Object),
    );
  });
});
