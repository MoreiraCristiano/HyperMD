import { describe, expect, it } from 'vitest';
import { appCommands, filterCommands, shortcutEntries } from '@/app/commands';
import {
  canonicalLanguageValue,
  codeLanguageOptions,
  filterCodeLanguages,
  languageLabel,
  loadCodeLanguage,
} from '@/features/documents/editor/codeblock/languages';
import { fileExtension, isImagePath, supportedImageExtensions } from '@/shared/utils/imageTypes';

describe('core rules', () => {
  it('extracts and recognizes image extensions', () => {
    expect(fileExtension('C:\\pics\\A.JPEG')).toBe('jpeg');
    expect(fileExtension('README')).toBe('');
    expect(isImagePath('/a/icon.SVG')).toBe(true);
    expect(isImagePath('/a/file.md')).toBe(false);
    expect(supportedImageExtensions).toContain('avif');
  });

  it('filters commands across metadata using every search term', () => {
    expect(filterCommands('')).toBe(appCommands);
    expect(filterCommands('open markdown').map(({ id }) => id)).toContain('file.open');
    expect(filterCommands('FILES workspace').map(({ id }) => id)).toContain('view.explorer');
    expect(filterCommands('table columns').map(({ id }) => id)).toContain('insert.table');
    expect(filterCommands('not-present')).toEqual([]);
    expect(shortcutEntries.some(({ shortcut }) => shortcut === 'Ctrl+Shift+P')).toBe(true);
  });

  it('normalizes and filters code languages', async () => {
    expect(languageLabel(null)).toBe('Plain Text');
    expect(languageLabel('js')).toBe('JavaScript');
    expect(languageLabel('made-up')).toBe('made-up');
    expect(canonicalLanguageValue('js')).toBeTruthy();
    expect(canonicalLanguageValue(null)).toBeNull();
    expect(filterCodeLanguages('')).toBe(codeLanguageOptions);
    expect(filterCodeLanguages('python').some(({ label }) => label === 'Python')).toBe(true);
    expect(await loadCodeLanguage(null)).toBeNull();
    expect(await loadCodeLanguage('made-up')).toBeNull();
  });
});
