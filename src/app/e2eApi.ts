import { documentManager } from '@/features/documents';
import { flushSettings } from '@/features/settings';

export type HyperMdE2eApi = {
  openDocument: (path: string) => Promise<boolean>;
  tryOpenDocument: (path: string) => Promise<{ opened?: boolean; error?: string }>;
  close: () => Promise<boolean>;
  save: () => Promise<boolean>;
  flushSession: () => Promise<void>;
  flushSettings: () => Promise<void>;
  prepareWindowClose: () => Promise<boolean>;
};

declare global {
  interface Window {
    __HYPERMD_E2E__?: HyperMdE2eApi;
  }
}

export function installE2eApi(): void {
  window.__HYPERMD_E2E__ = {
    openDocument: (path) => documentManager.open(path),
    tryOpenDocument: async (path) => {
      try {
        return { opened: await documentManager.open(path) };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    close: () => documentManager.close(),
    save: () => documentManager.save(),
    flushSession: () => documentManager.flushSession(),
    flushSettings,
    prepareWindowClose: () => documentManager.prepareWindowClose(),
  };
}
