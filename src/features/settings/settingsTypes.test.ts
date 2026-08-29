import { describe, expect, it } from 'vitest';
import { cloneDefaultSettings, DEFAULT_SETTINGS, normalizeSettings } from './settingsTypes';

describe('settingsTypes', () => {
  it('returns defaults for invalid input without sharing nested objects', () => {
    expect(normalizeSettings(null)).toEqual({
      ...DEFAULT_SETTINGS,
      editor: { ...DEFAULT_SETTINGS.editor, lineHeight: 1.7 },
    });
    const first = cloneDefaultSettings();
    const second = cloneDefaultSettings();
    expect(first.editor.lineHeight).toBe(1.7);
    expect(first).not.toBe(second);
    expect(first.editor).not.toBe(second.editor);
  });

  it('normalizes, clamps, rounds, and sanitizes every setting', () => {
    expect(
      normalizeSettings({
        appearance: { theme: 'unknown', uiFontFamily: ' Bad;{}\n Font ', uiFontSize: '99' },
        editor: {
          fontFamily: ' Editor\rFont ',
          codeBlockFontFamily: '',
          fontSize: 9.6,
          lineHeight: 1.26,
          maxWidth: 2000,
          wordWrap: false,
        },
        files: { autoSave: true },
      }),
    ).toEqual({
      appearance: { theme: 'dark', uiFontFamily: 'Bad Font', uiFontSize: 20 },
      editor: {
        fontFamily: 'EditorFont',
        codeBlockFontFamily: DEFAULT_SETTINGS.editor.codeBlockFontFamily,
        fontSize: 10,
        lineHeight: 1.3,
        maxWidth: 1600,
        wordWrap: false,
      },
      files: { autoSave: true },
    });
  });

  it('supports full width and rejects non-finite or wrongly typed values', () => {
    const settings = normalizeSettings({
      appearance: { uiFontSize: Infinity },
      editor: { maxWidth: 'full', wordWrap: 'yes' },
      files: { autoSave: 1 },
    });
    expect(settings.editor.maxWidth).toBeNull();
    expect(settings.editor.wordWrap).toBe(true);
    expect(settings.files.autoSave).toBe(false);
    expect(settings.appearance.uiFontSize).toBe(DEFAULT_SETTINGS.appearance.uiFontSize);
  });

  it('accepts only supported theme preferences', () => {
    expect(normalizeSettings({ appearance: { theme: 'light' } }).appearance.theme).toBe('light');
    expect(normalizeSettings({ appearance: { theme: 'system' } }).appearance.theme).toBe('system');
    expect(normalizeSettings({ appearance: { theme: 1 } }).appearance.theme).toBe('dark');
  });
});
