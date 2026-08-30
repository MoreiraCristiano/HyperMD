import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dependencyGraph, validateArchitecture } from './test/architectureGraph';

const sourceRoot = join(process.cwd(), 'src');
const fixtureRoot = join(sourceRoot, 'test', 'fixtures', 'architecture');

describe('architecture boundaries', () => {
  const projectViolations = validateArchitecture(sourceRoot);

  it('keeps Tauri dependencies inside platform adapters', () => {
    expect(projectViolations.filter(({ rule }) => rule === 'tauri-location')).toEqual([]);
  });

  it('enforces one-way layer dependencies for resolved files', () => {
    expect(projectViolations.filter(({ rule }) => rule === 'layer-direction')).toEqual([]);
  });

  it('requires cross-feature consumers to use index.ts', () => {
    expect(projectViolations.filter(({ rule }) => rule === 'feature-entrypoint')).toEqual([]);
  });

  it('prevents cycles between features', () => {
    expect(projectViolations.filter(({ rule }) => rule === 'feature-cycle')).toEqual([]);
  });

  it('parses static imports, exports, and dynamic imports with TypeScript', () => {
    expect(dependencyGraph(fixtureRoot).map(({ kind }) => kind)).toEqual(
      expect.arrayContaining(['import', 'export', 'dynamic-import']),
    );
  });

  it('resolves aliases to their real source files', () => {
    expect(dependencyGraph(sourceRoot)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          importer: 'features/documents/documentManager.ts',
          specifier: '@/platform/tauri/files',
          target: 'platform/tauri/files.ts',
        }),
      ]),
    );
  });

  it('detects illegal relative imports', () => {
    expect(validateArchitecture(fixtureRoot)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'layer-direction',
          importer: 'features/alpha/relative.ts',
          target: 'app/internal.ts',
          dependencyKind: 'import',
        }),
      ]),
    );
  });

  it('detects illegal dynamic imports', () => {
    expect(validateArchitecture(fixtureRoot)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'layer-direction',
          importer: 'shared/dynamic.ts',
          target: 'app/internal.ts',
          dependencyKind: 'dynamic-import',
        }),
      ]),
    );
  });

  it('detects indirect cross-feature exports', () => {
    expect(validateArchitecture(fixtureRoot)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'feature-entrypoint',
          importer: 'features/alpha/export.ts',
          target: 'features/beta/internal.ts',
          dependencyKind: 'export',
        }),
      ]),
    );
  });

  it('detects Tauri leaks and feature cycles', () => {
    const violations = validateArchitecture(fixtureRoot);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'tauri-location',
          importer: 'features/alpha/tauri.ts',
        }),
        expect.objectContaining({
          rule: 'feature-cycle',
          message: 'alpha -> beta -> alpha',
        }),
      ]),
    );
  });
});
