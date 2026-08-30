import { describe, expect, it } from 'vitest';
import { mergeMarkdownSource } from './markdownSource';

const canonicalize = (source: string) =>
  source
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[^]*?-->\s*/g, '')
    .replace(/\[([^\]]+)]\[note]/g, '[$1](./target.md)')
    .replace(/\n?\[note]: .*(?:\n|$)/g, '\n');

describe('lossless Markdown source merging', () => {
  it('returns the original source when the document did not change', () => {
    const source = '<!-- private -->\r\n\r\nText\r\n';
    const baseline = canonicalize(source);
    expect(mergeMarkdownSource({ source, canonical: baseline }, baseline, canonicalize)).toEqual({
      status: 'merged',
      source,
    });
  });

  it('preserves unsupported source around independent edits', () => {
    const source = '<!-- private -->\n\nFirst text.\n\nSecond text.\n';
    const baseline = canonicalize(source);
    const current = baseline.replace('First', 'Changed').replace('Second', 'Updated');
    expect(mergeMarkdownSource({ source, canonical: baseline }, current, canonicalize)).toEqual({
      status: 'merged',
      source: '<!-- private -->\n\nChanged text.\n\nUpdated text.\n',
    });
  });

  it('preserves reference links when editing their visible text', () => {
    const source = 'Read [original][note].\n\n[note]: ./target.md\n';
    const baseline = canonicalize(source);
    const current = baseline.replace('original', 'updated');
    expect(mergeMarkdownSource({ source, canonical: baseline }, current, canonicalize)).toEqual({
      status: 'merged',
      source: 'Read [updated][note].\n\n[note]: ./target.md\n',
    });
  });

  it('fails closed when an edit touches normalized-only syntax', () => {
    const source = 'Read [original][note].\n\n[note]: ./target.md\n';
    const baseline = canonicalize(source);
    const current = baseline.replace('./target.md', './other.md');
    expect(mergeMarkdownSource({ source, canonical: baseline }, current, canonicalize)).toEqual({
      status: 'conflict',
    });
  });
});
