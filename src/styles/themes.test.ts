import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const stylesDirectory = resolve(process.cwd(), 'src/styles');
const themePath = (name: string) => resolve(stylesDirectory, 'themes', `${name}.css`);
const properties = (source: string) =>
  new Set([...source.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((match) => match[1]));

describe('theme tokens', () => {
  it('defines the same complete token contract for dark and light', () => {
    const dark = properties(readFileSync(themePath('dark'), 'utf8'));
    const light = properties(readFileSync(themePath('light'), 'utf8'));
    expect(light).toEqual(dark);
    expect(dark).toContain('--color-surface-base');
    expect(dark).toContain('--syntax-keyword');
  });

  it('keeps component colors behind theme tokens', () => {
    const componentSources = ['base.css', 'shell.css', 'editor.css', 'overlays.css']
      .map((file) => readFileSync(resolve(stylesDirectory, file), 'utf8'))
      .join('\n');
    const codeMirrorTheme = readFileSync(
      resolve(process.cwd(), 'src/features/documents/editor/codeblock/theme.ts'),
      'utf8',
    );
    expect(componentSources).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\s*\(/i);
    expect(codeMirrorTheme).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\s*\(/i);
  });
});
