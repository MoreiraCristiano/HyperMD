export type CodeLanguage = {
  label: string;
  value: string;
};

export const CODE_LANGUAGES: CodeLanguage[] = [
  { label: 'Plain Text', value: '' },
  { label: 'Bash', value: 'bash' },
  { label: 'Shell', value: 'shell' },
  { label: 'PowerShell', value: 'powershell' },
  { label: 'Python', value: 'python' },
  { label: 'JavaScript', value: 'javascript' },
  { label: 'TypeScript', value: 'typescript' },
  { label: 'JSON', value: 'json' },
  { label: 'YAML', value: 'yaml' },
  { label: 'TOML', value: 'toml' },
  { label: 'HTML', value: 'html' },
  { label: 'CSS', value: 'css' },
  { label: 'SCSS', value: 'scss' },
  { label: 'SQL', value: 'sql' },
  { label: 'C', value: 'c' },
  { label: 'C++', value: 'cpp' },
  { label: 'C#', value: 'csharp' },
  { label: 'Java', value: 'java' },
  { label: 'Rust', value: 'rust' },
  { label: 'Go', value: 'go' },
  { label: 'Dockerfile', value: 'dockerfile' },
  { label: 'Markdown', value: 'markdown' },
  { label: 'XML', value: 'xml' },
];

const aliases: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  sh: 'bash',
  zsh: 'shell',
  ps: 'powershell',
  ps1: 'powershell',
  pwsh: 'powershell',
  yml: 'yaml',
  'c++': 'cpp',
  cc: 'cpp',
  cs: 'csharp',
  'c#': 'csharp',
  rs: 'rust',
  md: 'markdown',
  docker: 'dockerfile',
};

const supported = new Set(CODE_LANGUAGES.map((language) => language.value).filter(Boolean));

export function canonicalLanguage(language: unknown): string | null {
  if (typeof language !== 'string' || !language.trim()) return null;
  const original = language.trim();
  const normalized = original.toLowerCase();
  return aliases[normalized] ?? (supported.has(normalized) ? normalized : original);
}

export function canHighlight(language: string | null): language is string {
  return Boolean(language && supported.has(language));
}

export function languageLabel(language: string | null): string {
  if (!language) return 'Plain Text';
  return CODE_LANGUAGES.find((option) => option.value === language)?.label ?? language;
}
