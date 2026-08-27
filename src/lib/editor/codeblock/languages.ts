import { LanguageDescription, type LanguageSupport } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

const languageCache = new Map<string, Promise<LanguageSupport | null>>();

export function loadCodeLanguage(language: string | null): Promise<LanguageSupport | null> {
  const name = language?.trim();
  if (!name) return Promise.resolve(null);

  const cacheKey = name.toLocaleLowerCase();
  const cached = languageCache.get(cacheKey);
  if (cached) return cached;

  const description = LanguageDescription.matchLanguageName(languages, name, false);
  const loading = description
    ? description.load().catch((error: unknown) => {
        console.warn(`Não foi possível carregar a linguagem ${name}.`, error);
        return null;
      })
    : Promise.resolve(null);

  languageCache.set(cacheKey, loading);
  return loading;
}
