import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const sourceExtensions = new Set(['.ts', '.svelte']);
const resolutionSuffixes = ['', '.ts', '.svelte', '/index.ts', '/index.svelte'];

export type DependencyKind = 'import' | 'export' | 'dynamic-import';

export type SourceDependency = {
  importer: string;
  kind: DependencyKind;
  specifier: string;
  target: string | null;
};

export type ArchitectureRule =
  'tauri-location' | 'layer-direction' | 'feature-entrypoint' | 'feature-cycle';

export type ArchitectureViolation = {
  rule: ArchitectureRule;
  message: string;
  importer?: string;
  target?: string;
  dependencyKind?: DependencyKind;
};

type Owner =
  { kind: 'app' | 'platform' | 'shared' | 'root' } | { kind: 'feature'; feature: string };

function normalized(path: string): string {
  return path.split(sep).join('/');
}

export function sourceFiles(sourceRoot: string): string[] {
  function visit(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (directory === sourceRoot && entry.name === 'test') return [];
        return visit(path);
      }
      if (!sourceExtensions.has(extname(entry.name)) || entry.name.endsWith('.test.ts')) return [];
      return [realpathSync(path)];
    });
  }
  return visit(realpathSync(sourceRoot));
}

function scriptSources(path: string): string[] {
  const source = readFileSync(path, 'utf8');
  if (extname(path) !== '.svelte') return [source];
  const scripts: string[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf('<script', cursor);
    if (start === -1) break;
    const contentStart = source.indexOf('>', start);
    if (contentStart === -1) break;
    const end = source.indexOf('</script>', contentStart + 1);
    if (end === -1) break;
    scripts.push(source.slice(contentStart + 1, end));
    cursor = end + '</script>'.length;
  }
  return scripts;
}

function moduleSpecifier(node: ts.Expression | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function parsedDependencies(path: string): Array<{ kind: DependencyKind; specifier: string }> {
  const dependencies: Array<{ kind: DependencyKind; specifier: string }> = [];
  for (const [index, source] of scriptSources(path).entries()) {
    const syntax = ts.createSourceFile(
      `${path}:${index}`,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node)) {
        const specifier = moduleSpecifier(node.moduleSpecifier);
        if (specifier) dependencies.push({ kind: 'import', specifier });
      } else if (ts.isExportDeclaration(node)) {
        const specifier = moduleSpecifier(node.moduleSpecifier);
        if (specifier) dependencies.push({ kind: 'export', specifier });
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        const specifier = moduleSpecifier(node.arguments[0]);
        if (specifier) dependencies.push({ kind: 'dynamic-import', specifier });
      }
      ts.forEachChild(node, visit);
    };
    visit(syntax);
  }
  return dependencies;
}

function resolvedSource(candidate: string): string | null {
  for (const suffix of resolutionSuffixes) {
    const path = resolve(`${candidate}${suffix}`);
    if (!existsSync(path) || !statSync(path).isFile()) continue;
    return realpathSync(path);
  }
  return null;
}

function resolveDependency(sourceRoot: string, importer: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) {
    return resolvedSource(join(sourceRoot, specifier.slice(2)));
  }
  if (specifier.startsWith('.')) {
    return resolvedSource(join(dirname(importer), specifier));
  }
  return null;
}

function sourcePath(sourceRoot: string, path: string): string {
  return normalized(relative(sourceRoot, path));
}

function owner(path: string): Owner {
  const parts = path.split('/');
  if (parts[0] === 'features' && parts[1]) return { kind: 'feature', feature: parts[1] };
  if (parts[0] === 'app' || parts[0] === 'platform' || parts[0] === 'shared') {
    return { kind: parts[0] };
  }
  return { kind: 'root' };
}

export function dependencyGraph(sourceRoot: string): SourceDependency[] {
  const root = realpathSync(sourceRoot);
  return sourceFiles(root).flatMap((path) =>
    parsedDependencies(path).map(({ kind, specifier }) => {
      const target = resolveDependency(root, path, specifier);
      return {
        importer: sourcePath(root, path),
        kind,
        specifier,
        target: target ? sourcePath(root, target) : null,
      };
    }),
  );
}

function featureCycles(edges: Map<string, Set<string>>): string[][] {
  const visited = new Set<string>();
  const active = new Set<string>();
  const stack: string[] = [];
  const cycles = new Map<string, string[]>();

  const visit = (feature: string): void => {
    visited.add(feature);
    active.add(feature);
    stack.push(feature);
    for (const dependency of edges.get(feature) ?? []) {
      if (!visited.has(dependency)) {
        visit(dependency);
      } else if (active.has(dependency)) {
        const cycle = [...stack.slice(stack.indexOf(dependency)), dependency];
        const members = cycle.slice(0, -1);
        const first = members.reduce(
          (lowest, value, index) => (value < members[lowest] ? index : lowest),
          0,
        );
        const canonical = [...members.slice(first), ...members.slice(0, first)];
        cycles.set(canonical.join(' -> '), [...canonical, canonical[0]]);
      }
    }
    stack.pop();
    active.delete(feature);
  };

  for (const feature of [...edges.keys()].sort()) {
    if (!visited.has(feature)) visit(feature);
  }
  return [...cycles.values()];
}

export function validateArchitecture(sourceRoot: string): ArchitectureViolation[] {
  const root = realpathSync(sourceRoot);
  const dependencies = dependencyGraph(root);
  const violations: ArchitectureViolation[] = [];
  const featureEdges = new Map<string, Set<string>>();

  for (const dependency of dependencies) {
    const importerOwner = owner(dependency.importer);
    if (
      dependency.specifier.startsWith('@tauri-apps/') &&
      !dependency.importer.startsWith('platform/tauri/')
    ) {
      violations.push({
        rule: 'tauri-location',
        message: `${dependency.importer} -> ${dependency.specifier}`,
        importer: dependency.importer,
        dependencyKind: dependency.kind,
      });
    }
    if (!dependency.target) continue;
    const target = dependency.target;
    const targetOwner = owner(target);
    const illegalLayer =
      (importerOwner.kind === 'platform' &&
        ['app', 'feature', 'shared'].includes(targetOwner.kind)) ||
      (importerOwner.kind === 'shared' && ['app', 'feature'].includes(targetOwner.kind)) ||
      (importerOwner.kind === 'feature' && targetOwner.kind === 'app');
    if (illegalLayer) {
      violations.push({
        rule: 'layer-direction',
        message: `${dependency.importer} -> ${target}`,
        importer: dependency.importer,
        target,
        dependencyKind: dependency.kind,
      });
    }
    if (
      importerOwner.kind === 'feature' &&
      targetOwner.kind === 'feature' &&
      importerOwner.feature !== targetOwner.feature
    ) {
      const targets = featureEdges.get(importerOwner.feature) ?? new Set<string>();
      targets.add(targetOwner.feature);
      featureEdges.set(importerOwner.feature, targets);
      if (target !== `features/${targetOwner.feature}/index.ts`) {
        violations.push({
          rule: 'feature-entrypoint',
          message: `${dependency.importer} -> ${target}`,
          importer: dependency.importer,
          target,
          dependencyKind: dependency.kind,
        });
      }
    }
  }

  for (const cycle of featureCycles(featureEdges)) {
    violations.push({ rule: 'feature-cycle', message: cycle.join(' -> ') });
  }
  return violations.sort((left, right) => left.message.localeCompare(right.message));
}
