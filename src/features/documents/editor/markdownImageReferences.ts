import { dirname } from '@/platform/tauri/path';
import { relativeMarkdownImagePath, resolveMarkdownImagePath } from '../images/localImage';

type Destination = {
  start: number;
  end: number;
  value: string;
};

type Replacement = Destination & { replacement: string };

function comparablePath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return /^[A-Za-z]:/.test(normalized) ? normalized.toLowerCase() : normalized;
}

function sourceSuffix(source: string): string {
  const index = source.search(/[?#]/);
  return index === -1 ? '' : source.slice(index);
}

function escaped(source: string, position: number): boolean {
  let slashes = 0;
  for (let index = position - 1; index >= 0 && source[index] === '\\'; index -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function closeBracket(source: string, start: number): number {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (escaped(source, index)) continue;
    if (source[index] === '[') depth += 1;
    if (source[index] === ']' && --depth === 0) return index;
  }
  return -1;
}

function exclusions(source: string): Uint8Array {
  const excluded = new Uint8Array(source.length);
  const mark = (start: number, end: number) => excluded.fill(1, start, end);

  let fence: { marker: string; size: number } | null = null;
  for (let start = 0; start < source.length;) {
    const newline = source.indexOf('\n', start);
    const end = newline === -1 ? source.length : newline + 1;
    const line = source.slice(start, end).replace(/\r?\n$/, '');
    const wasFenced = fence !== null;
    if (!wasFenced) {
      const opening = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (opening) fence = { marker: opening[1][0], size: opening[1].length };
    }
    if (fence) {
      mark(start, end);
      const closing = line.match(/^ {0,3}(`+|~+)\s*$/)?.[1];
      if (wasFenced && closing && closing[0] === fence.marker && closing.length >= fence.size) {
        fence = null;
      }
    }
    start = end;
  }

  for (let start = source.indexOf('<!--'); start !== -1; start = source.indexOf('<!--', start)) {
    const closing = source.indexOf('-->', start + 4);
    const end = closing === -1 ? source.length : closing + 3;
    mark(start, end);
    start = end;
  }

  for (let start = 0; start < source.length; start += 1) {
    if (excluded[start] || source[start] !== '`') continue;
    let size = 1;
    while (source[start + size] === '`') size += 1;
    const closing = source.indexOf('`'.repeat(size), start + size);
    if (closing !== -1) {
      mark(start, closing + size);
      start = closing + size - 1;
    }
  }
  return excluded;
}

function directDestination(source: string, opening: number): Destination | null {
  let start = opening + 1;
  while (/[ \t\r\n]/.test(source[start] ?? '')) start += 1;
  if (source[start] === '<') {
    const end = source.indexOf('>', start + 1);
    return end === -1 ? null : { start: start + 1, end, value: source.slice(start + 1, end) };
  }
  const destinationStart = start;
  let depth = 0;
  while (start < source.length) {
    if (escaped(source, start)) {
      start += 2;
      continue;
    }
    const character = source[start];
    if (character === '(') depth += 1;
    else if (character === ')') {
      if (depth === 0) break;
      depth -= 1;
    } else if (/\s/.test(character) && depth === 0) break;
    start += 1;
  }
  return start === destinationStart
    ? null
    : { start: destinationStart, end: start, value: source.slice(destinationStart, start) };
}

function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

function imageDestinations(
  source: string,
  excluded: Uint8Array,
): {
  direct: Destination[];
  references: Set<string>;
} {
  const direct: Destination[] = [];
  const references = new Set<string>();
  for (let index = 0; index < source.length - 1; index += 1) {
    if (
      excluded[index] ||
      source[index] !== '!' ||
      source[index + 1] !== '[' ||
      escaped(source, index)
    ) {
      continue;
    }
    const altEnd = closeBracket(source, index + 1);
    if (altEnd === -1) continue;
    const alt = source.slice(index + 2, altEnd);
    let next = altEnd + 1;
    while (source[next] === ' ' || source[next] === '\t') next += 1;
    if (source[next] === '(') {
      const destination = directDestination(source, next);
      if (destination) direct.push(destination);
    } else if (source[next] === '[') {
      const referenceEnd = closeBracket(source, next);
      if (referenceEnd !== -1) {
        references.add(normalizeLabel(source.slice(next + 1, referenceEnd) || alt));
      }
    } else {
      references.add(normalizeLabel(alt));
    }
    index = altEnd;
  }
  return { direct, references };
}

function referenceDestinations(
  source: string,
  excluded: Uint8Array,
  references: Set<string>,
): Destination[] {
  const destinations: Destination[] = [];
  const definitions = /^( {0,3})\[([^\]\r\n]+)]\:[ \t]*(?:<([^>\r\n]*)>|([^\s]+))/gm;
  const seen = new Set<string>();
  for (const match of source.matchAll(definitions)) {
    const position = match.index ?? 0;
    if (excluded[position]) continue;
    const label = normalizeLabel(match[2]);
    if (!references.has(label) || seen.has(label)) continue;
    seen.add(label);
    const value = match[3] ?? match[4];
    const relative = match[0].lastIndexOf(value);
    const start = position + relative;
    destinations.push({ start, end: start + value.length, value });
  }
  return destinations;
}

function markdownDestination(value: string): string {
  return value.replace(/ /g, '%20');
}

export async function rewriteMarkdownImageReferences(
  source: string,
  documentPath: string,
  oldImagePath: string,
  newImagePath: string,
): Promise<{ source: string; changed: boolean }> {
  const excluded = exclusions(source);
  const images = imageDestinations(source, excluded);
  const destinations = [
    ...images.direct,
    ...referenceDestinations(source, excluded, images.references),
  ];
  const destination = markdownDestination(
    relativeMarkdownImagePath(await dirname(documentPath), newImagePath),
  );
  const oldComparable = comparablePath(oldImagePath);
  const replacements: Replacement[] = [];
  for (const candidate of destinations) {
    const unescaped = candidate.value.replace(/\\([\\()[\] ])/g, '$1');
    const absolute = await resolveMarkdownImagePath(unescaped, documentPath);
    if (!absolute || comparablePath(absolute) !== oldComparable) continue;
    replacements.push({
      ...candidate,
      replacement: `${destination}${sourceSuffix(unescaped)}`,
    });
  }
  if (replacements.length === 0) return { source, changed: false };
  let updated = source;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    updated = `${updated.slice(0, replacement.start)}${replacement.replacement}${updated.slice(replacement.end)}`;
  }
  return { source: updated, changed: true };
}
