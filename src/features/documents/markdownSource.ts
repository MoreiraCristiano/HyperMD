export type MarkdownSourceSnapshot = {
  source: string;
  canonical: string;
};

export type MarkdownSourceMerge = { status: 'merged'; source: string } | { status: 'conflict' };

type DiffPart = {
  added?: boolean;
  removed?: boolean;
  value: string;
};

type EqualRange = {
  baselineStart: number;
  baselineEnd: number;
  sourceStart: number;
};

type Edit = {
  start: number;
  end: number;
  replacement: string;
};

const MAX_DIFF_STEPS = 4_000_000;

function valueAt(values: Map<number, number>, key: number): number {
  return values.get(key) ?? Number.NEGATIVE_INFINITY;
}

function append(parts: DiffPart[], part: DiffPart): void {
  const previous = parts.at(-1);
  if (previous && previous.added === part.added && previous.removed === part.removed) {
    previous.value += part.value;
  } else {
    parts.push(part);
  }
}

function backtrack(
  left: string,
  right: string,
  trace: Array<Map<number, number>>,
  distance: number,
): DiffPart[] {
  let x = left.length;
  let y = right.length;
  const reversed: DiffPart[] = [];

  for (let depth = distance; depth > 0; depth -= 1) {
    const previous = trace[depth - 1];
    const diagonal = x - y;
    const previousDiagonal =
      diagonal === -depth ||
      (diagonal !== depth && valueAt(previous, diagonal - 1) < valueAt(previous, diagonal + 1))
        ? diagonal + 1
        : diagonal - 1;
    const previousX = valueAt(previous, previousDiagonal);
    const previousY = previousX - previousDiagonal;

    while (x > previousX && y > previousY) {
      reversed.push({ value: left[x - 1] });
      x -= 1;
      y -= 1;
    }
    if (x === previousX) {
      reversed.push({ added: true, value: right[y - 1] });
      y -= 1;
    } else {
      reversed.push({ removed: true, value: left[x - 1] });
      x -= 1;
    }
  }
  while (x > 0 && y > 0) {
    reversed.push({ value: left[x - 1] });
    x -= 1;
    y -= 1;
  }
  while (x > 0) {
    reversed.push({ removed: true, value: left[x - 1] });
    x -= 1;
  }
  while (y > 0) {
    reversed.push({ added: true, value: right[y - 1] });
    y -= 1;
  }

  const parts: DiffPart[] = [];
  for (const part of reversed.reverse()) append(parts, part);
  return parts;
}

function diff(left: string, right: string): DiffPart[] | null {
  if (left === right) return left ? [{ value: left }] : [];
  const limit = left.length + right.length;
  let work = 0;
  let frontier = new Map<number, number>([[1, 0]]);
  const trace: Array<Map<number, number>> = [];

  for (let distance = 0; distance <= limit; distance += 1) {
    const next = new Map<number, number>();
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      work += 1;
      if (work > MAX_DIFF_STEPS) return null;
      let x =
        diagonal === -distance ||
        (diagonal !== distance && valueAt(frontier, diagonal - 1) < valueAt(frontier, diagonal + 1))
          ? valueAt(frontier, diagonal + 1)
          : valueAt(frontier, diagonal - 1) + 1;
      if (!Number.isFinite(x)) x = 0;
      let y = x - diagonal;
      while (x < left.length && y < right.length && left[x] === right[y]) {
        x += 1;
        y += 1;
      }
      next.set(diagonal, x);
      if (x >= left.length && y >= right.length) {
        trace.push(next);
        return backtrack(left, right, trace, distance);
      }
    }
    trace.push(next);
    frontier = next;
  }
  return null;
}

function equalRanges(baseline: string, source: string): EqualRange[] | null {
  if (baseline.length === 0 && source.length === 0) {
    return [{ baselineStart: 0, baselineEnd: 0, sourceStart: 0 }];
  }
  const parts = diff(baseline, source);
  if (!parts) return null;
  const ranges: EqualRange[] = [];
  let baselineOffset = 0;
  let sourceOffset = 0;
  for (const part of parts) {
    if (part.added) {
      sourceOffset += part.value.length;
    } else if (part.removed) {
      baselineOffset += part.value.length;
    } else {
      ranges.push({
        baselineStart: baselineOffset,
        baselineEnd: baselineOffset + part.value.length,
        sourceStart: sourceOffset,
      });
      baselineOffset += part.value.length;
      sourceOffset += part.value.length;
    }
  }
  return ranges;
}

function edits(baseline: string, current: string): Edit[] | null {
  const parts = diff(baseline, current);
  if (!parts) return null;
  const changes: Edit[] = [];
  let baselineOffset = 0;
  let pending: Edit | null = null;
  for (const part of parts) {
    if (!part.added && !part.removed) {
      if (pending) changes.push(pending);
      pending = null;
      baselineOffset += part.value.length;
      continue;
    }
    pending ??= { start: baselineOffset, end: baselineOffset, replacement: '' };
    if (part.removed) {
      pending.end += part.value.length;
      baselineOffset += part.value.length;
    } else {
      pending.replacement += part.value;
    }
  }
  if (pending) changes.push(pending);
  return changes;
}

function mapEdit(edit: Edit, ranges: EqualRange[]): { start: number; end: number } | null {
  if (edit.start === edit.end) {
    const candidates = ranges.filter(
      (range) => edit.start >= range.baselineStart && edit.start <= range.baselineEnd,
    );
    if (candidates.length === 0) return null;
    const mapped = new Set(
      candidates.map((range) => range.sourceStart + edit.start - range.baselineStart),
    );
    if (mapped.size !== 1) return null;
    const position = [...mapped][0];
    return { start: position, end: position };
  }
  const range = ranges.find(
    (candidate) => edit.start >= candidate.baselineStart && edit.end <= candidate.baselineEnd,
  );
  if (!range) return null;
  return {
    start: range.sourceStart + edit.start - range.baselineStart,
    end: range.sourceStart + edit.end - range.baselineStart,
  };
}

export function mergeMarkdownSource(
  snapshot: MarkdownSourceSnapshot,
  currentCanonical: string,
  canonicalize: (source: string) => string,
): MarkdownSourceMerge {
  if (currentCanonical === snapshot.canonical) {
    return { status: 'merged', source: snapshot.source };
  }
  const ranges = equalRanges(snapshot.canonical, snapshot.source);
  const changes = edits(snapshot.canonical, currentCanonical);
  if (!ranges || !changes) return { status: 'conflict' };

  const mapped = changes.map((edit) => ({ edit, range: mapEdit(edit, ranges) }));
  if (mapped.some(({ range }) => !range)) return { status: 'conflict' };
  let source = snapshot.source;
  for (const { edit, range } of mapped.reverse()) {
    source = `${source.slice(0, range!.start)}${edit.replacement}${source.slice(range!.end)}`;
  }
  return canonicalize(source) === currentCanonical
    ? { status: 'merged', source }
    : { status: 'conflict' };
}
