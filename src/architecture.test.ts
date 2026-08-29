import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = join(process.cwd(), 'src');
const sourceExtensions = new Set(['.ts', '.svelte']);

function sourceFiles(directory = sourceRoot): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!sourceExtensions.has(extname(entry.name)) || entry.name.endsWith('.test.ts')) return [];
    return [path];
  });
}

function imports(path: string): string[] {
  const text = readFileSync(path, 'utf8');
  return [...text.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

function sourcePath(path: string): string {
  return relative(sourceRoot, path).split(sep).join('/');
}

describe('architecture boundaries', () => {
  it('keeps Tauri dependencies inside platform adapters', () => {
    const violations = sourceFiles().flatMap((path) =>
      imports(path).some((value) => value.startsWith('@tauri-apps/')) &&
      !sourcePath(path).startsWith('platform/tauri/')
        ? [sourcePath(path)]
        : [],
    );
    expect(violations).toEqual([]);
  });

  it('enforces one-way layer dependencies', () => {
    const violations: string[] = [];
    for (const path of sourceFiles()) {
      const owner = sourcePath(path);
      for (const dependency of imports(path)) {
        if (owner.startsWith('platform/') && dependency.startsWith('@/')) {
          violations.push(`${owner} -> ${dependency}`);
        }
        if (
          owner.startsWith('shared/') &&
          (dependency.startsWith('@/app') || dependency.startsWith('@/features'))
        ) {
          violations.push(`${owner} -> ${dependency}`);
        }
        if (owner.startsWith('features/') && dependency.startsWith('@/app')) {
          violations.push(`${owner} -> ${dependency}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('requires feature consumers to use public entrypoints', () => {
    const violations: string[] = [];
    for (const path of sourceFiles()) {
      const owner = sourcePath(path);
      const ownerFeature = owner.match(/^features\/([^/]+)\//)?.[1];
      for (const dependency of imports(path)) {
        const target = dependency.match(/^@\/features\/([^/]+)(\/.*)?$/);
        if (!target || target[1] === ownerFeature || !target[2]) continue;
        violations.push(`${owner} -> ${dependency}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
