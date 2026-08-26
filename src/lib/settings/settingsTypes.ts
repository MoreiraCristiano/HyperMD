export type AppSettings = {
  appearance: {
    uiFontFamily: string;
    uiFontSize: number;
  };
  editor: {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    maxWidth: number | null;
    wordWrap: boolean;
  };
  files: {
    autoSave: boolean;
  };
};

export const DEFAULT_SETTINGS: AppSettings = {
  appearance: {
    uiFontFamily: 'Inter, "Segoe UI", sans-serif',
    uiFontSize: 12,
  },
  editor: {
    fontFamily: 'Inter, "Segoe UI", sans-serif',
    fontSize: 17,
    lineHeight: 1.72,
    maxWidth: 800,
    wordWrap: true,
  },
  files: {
    autoSave: false,
  },
};

function clamp(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? Math.min(maximum, Math.max(minimum, numeric)) : fallback;
}

function fontFamily(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const safe = value
    .replace(/[;{}\r\n]/g, '')
    .trim()
    .slice(0, 200);
  return safe || fallback;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function normalizeSettings(value: unknown): AppSettings {
  const root = record(value);
  const appearance = record(root.appearance);
  const editor = record(root.editor);
  const files = record(root.files);
  const width = editor.maxWidth;

  return {
    appearance: {
      uiFontFamily: fontFamily(appearance.uiFontFamily, DEFAULT_SETTINGS.appearance.uiFontFamily),
      uiFontSize: Math.round(
        clamp(appearance.uiFontSize, 10, 20, DEFAULT_SETTINGS.appearance.uiFontSize),
      ),
    },
    editor: {
      fontFamily: fontFamily(editor.fontFamily, DEFAULT_SETTINGS.editor.fontFamily),
      fontSize: Math.round(clamp(editor.fontSize, 10, 32, DEFAULT_SETTINGS.editor.fontSize)),
      lineHeight:
        Math.round(clamp(editor.lineHeight, 1.2, 2.2, DEFAULT_SETTINGS.editor.lineHeight) * 10) /
        10,
      maxWidth:
        width === null || width === 'full'
          ? null
          : Math.round(clamp(width, 500, 1600, DEFAULT_SETTINGS.editor.maxWidth ?? 800)),
      wordWrap:
        typeof editor.wordWrap === 'boolean' ? editor.wordWrap : DEFAULT_SETTINGS.editor.wordWrap,
    },
    files: {
      autoSave:
        typeof files.autoSave === 'boolean' ? files.autoSave : DEFAULT_SETTINGS.files.autoSave,
    },
  };
}

export function cloneDefaultSettings(): AppSettings {
  return normalizeSettings(DEFAULT_SETTINGS);
}
