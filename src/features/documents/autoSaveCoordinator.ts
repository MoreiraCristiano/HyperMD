import { get } from 'svelte/store';
import { settingsStore } from '@/features/settings';
import { isMarkdownTab, tabsState, type EditorTab } from './tabs/tabStore';

export interface AutoSaveService {
  schedule(tab: EditorTab): void;
  clear(id: string): void;
  scheduleSessionPersist(): void;
  persistSession(): void;
  flushSession(): Promise<void>;
  dispose(): void;
}

type AutoSaveCoordinatorOptions = {
  save: (id: string) => Promise<boolean>;
  persistSession: () => void;
  flushSession: () => Promise<void>;
};

export class AutoSaveCoordinator implements AutoSaveService {
  private readonly autoSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private autoSaveEnabled = false;
  private readonly unsubscribeSettings: () => void;

  constructor(private readonly options: AutoSaveCoordinatorOptions) {
    this.unsubscribeSettings = settingsStore.subscribe((settings) => {
      const enabled = settings.files.autoSave;
      const wasEnabled = this.autoSaveEnabled;
      this.autoSaveEnabled = enabled;
      if (!enabled) {
        this.clearAllAutoSaves();
      } else if (!wasEnabled) {
        for (const tab of get(tabsState).tabs) this.schedule(tab);
      }
    });
  }

  schedule(tab: EditorTab): void {
    this.clear(tab.id);
    if (!this.autoSaveEnabled || !isMarkdownTab(tab) || !tab.dirty || !tab.path || tab.missing) {
      return;
    }
    this.autoSaveTimers.set(
      tab.id,
      setTimeout(() => {
        this.autoSaveTimers.delete(tab.id);
        const current = get(tabsState).tabs.find((candidate) => candidate.id === tab.id);
        if (!current || !isMarkdownTab(current) || !current.dirty || !current.path) return;
        void this.options.save(current.id).catch((error) =>
          console.warn(`Auto Save failed for ${current.name}.`, error),
        );
      }, 1000),
    );
  }

  clear(id: string): void {
    const timer = this.autoSaveTimers.get(id);
    if (timer) clearTimeout(timer);
    this.autoSaveTimers.delete(id);
  }

  scheduleSessionPersist(): void {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.options.persistSession(), 800);
  }

  persistSession(): void {
    this.options.persistSession();
  }

  async flushSession(): Promise<void> {
    clearTimeout(this.persistTimer);
    this.persistTimer = undefined;
    await this.options.flushSession();
  }

  dispose(): void {
    clearTimeout(this.persistTimer);
    this.clearAllAutoSaves();
    this.unsubscribeSettings();
  }

  private clearAllAutoSaves(): void {
    for (const timer of this.autoSaveTimers.values()) clearTimeout(timer);
    this.autoSaveTimers.clear();
  }
}
