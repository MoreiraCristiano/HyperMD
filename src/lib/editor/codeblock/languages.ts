import { LanguageDescription, type LanguageSupport } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

const languageCache = new Map<string, Promise<LanguageSupport | null>>();

export type CodeLanguageOption = {
  label: string;
  value: string | null;
  searchText: string;
};

export const codeLanguageOptions: readonly CodeLanguageOption[] = [
  { label: 'Plain Text', value: null, searchText: 'plain text plaintext txt' },
  ...languages
    .map((description) => ({
      label: description.name,
      value: description.alias.at(-1) ?? description.name.toLocaleLowerCase().replaceAll(' ', '-'),
      searchText: [description.name, ...description.alias].join(' ').toLocaleLowerCase(),
    }))
    .sort((left, right) =>
      left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }),
    ),
];

export function languageLabel(language: string | null): string {
  if (!language) return 'Plain Text';
  return LanguageDescription.matchLanguageName(languages, language, false)?.name ?? language;
}

export function canonicalLanguageValue(language: string | null): string | null {
  if (!language) return null;
  const description = LanguageDescription.matchLanguageName(languages, language, false);
  return description?.alias.at(-1) ?? language;
}

export function filterCodeLanguages(query: string): readonly CodeLanguageOption[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return codeLanguageOptions;
  return codeLanguageOptions.filter((option) => option.searchText.includes(needle));
}

export function loadCodeLanguage(language: string | null): Promise<LanguageSupport | null> {
  const name = language?.trim();
  if (!name) return Promise.resolve(null);

  const cacheKey = name.toLocaleLowerCase();
  const cached = languageCache.get(cacheKey);
  if (cached) return cached;

  const description = LanguageDescription.matchLanguageName(languages, name, false);
  const loading = description
    ? description.load().catch((error: unknown) => {
        console.warn(`Could not load the ${name} language.`, error);
        return null;
      })
    : Promise.resolve(null);

  languageCache.set(cacheKey, loading);
  return loading;
}
