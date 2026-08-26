import type { HighlighterCore } from 'shiki/core';
import { canHighlight } from '../codeblock/languages';

export type HighlightSpan = {
  from: number;
  to: number;
  style: string;
};

const THEME = 'github-dark-default';
const MAX_CACHE_ENTRIES = 300;
const cache = new Map<string, Promise<HighlightSpan[]>>();
const languageLoads = new Map<string, Promise<void>>();
let highlighterPromise: Promise<HighlighterCore> | null = null;

const grammarLoaders: Record<string, () => Promise<{ default: unknown[] }>> = {
  bash: () => import('@shikijs/langs/bash'),
  shell: () => import('@shikijs/langs/bash'),
  powershell: () => import('@shikijs/langs/powershell'),
  python: () => import('@shikijs/langs/python'),
  javascript: () => import('@shikijs/langs/javascript'),
  typescript: () => import('@shikijs/langs/typescript'),
  json: () => import('@shikijs/langs/json'),
  yaml: () => import('@shikijs/langs/yaml'),
  toml: () => import('@shikijs/langs/toml'),
  html: () => import('@shikijs/langs/html'),
  css: () => import('@shikijs/langs/css'),
  scss: () => import('@shikijs/langs/scss'),
  sql: () => import('@shikijs/langs/sql'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  java: () => import('@shikijs/langs/java'),
  rust: () => import('@shikijs/langs/rust'),
  go: () => import('@shikijs/langs/go'),
  dockerfile: () => import('@shikijs/langs/dockerfile'),
  markdown: () => import('@shikijs/langs/markdown'),
  xml: () => import('@shikijs/langs/xml'),
};

async function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= Promise.all([
    import('shiki/core'),
    import('shiki/engine/oniguruma'),
    import('shiki/wasm'),
    import('@shikijs/themes/github-dark-default'),
  ]).then(async ([{ createHighlighterCore }, { createOnigurumaEngine }, wasm, theme]) =>
    createHighlighterCore({
      themes: [theme.default],
      langs: [],
      engine: createOnigurumaEngine(wasm.default),
    }),
  );
  return highlighterPromise;
}

async function loadLanguage(language: string): Promise<HighlighterCore> {
  const highlighter = await getHighlighter();
  let loading = languageLoads.get(language);
  if (!loading) {
    loading = grammarLoaders[language]().then(async (module) => {
      await highlighter.loadLanguage(
        ...(module.default as Parameters<HighlighterCore['loadLanguage']>),
      );
    });
    languageLoads.set(language, loading);
  }
  await loading;
  return highlighter;
}

async function createSpans(code: string, language: string): Promise<HighlightSpan[]> {
  const highlighter = await loadLanguage(language);
  const { tokens } = highlighter.codeToTokens(code, { lang: language, theme: THEME });
  const spans: HighlightSpan[] = [];
  let offset = 0;
  for (const line of tokens) {
    for (const token of line) {
      const from = offset;
      const to = from + token.content.length;
      const style = [
        token.color ? `color:${token.color}` : '',
        token.fontStyle && token.fontStyle & 1 ? 'font-style:italic' : '',
        token.fontStyle && token.fontStyle & 2 ? 'font-weight:600' : '',
        token.fontStyle && token.fontStyle & 4 ? 'text-decoration:underline' : '',
      ]
        .filter(Boolean)
        .join(';');
      if (to > from && style) spans.push({ from, to, style });
      offset = to;
    }
    offset += 1;
  }
  return spans;
}

export function highlightCode(code: string, language: string | null): Promise<HighlightSpan[]> {
  if (!canHighlight(language) || !code) return Promise.resolve([]);
  const key = `${language}\0${code}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const highlighted = createSpans(code, language).catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, highlighted);
  if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  return highlighted;
}
