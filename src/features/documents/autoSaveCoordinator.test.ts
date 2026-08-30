import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsStore } from '@/features/settings';
import { tabsState, type EditorTab } from './tabs/tabStore';
import { AutoSaveCoordinator } from './autoSaveCoordinator';

function markdownTab(id = 'document'): EditorTab {
  return {
    id,
    path: `/work/${id}.md`,
    name: `${id}.md`,
    type: 'markdown',
    pinned: false,
    state: { doc: {} as ProseMirrorNode } as EditorState,
    savedDoc: {} as ProseMirrorNode,
    dirty: true,
    missing: false,
  };
}

function coordinator() {
  const options = {
    save: vi.fn().mockResolvedValue(true),
    persistSession: vi.fn(),
    flushSession: vi.fn().mockResolvedValue(undefined),
  };
  return { instance: new AutoSaveCoordinator(options), options };
}

describe('AutoSaveCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    settingsStore.update((settings) => ({
      ...settings,
      files: { ...settings.files, autoSave: false },
    }));
    tabsState.set({ tabs: [], activeId: null, ready: true });
  });

  it('persists recovery within 800 ms despite continuous scheduling', async () => {
    const { instance, options } = coordinator();

    instance.scheduleSessionPersist();
    await vi.advanceTimersByTimeAsync(400);
    instance.scheduleSessionPersist();
    await vi.advanceTimersByTimeAsync(399);
    expect(options.persistSession).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(options.persistSession).toHaveBeenCalledTimes(1);

    instance.scheduleSessionPersist();
    await vi.advanceTimersByTimeAsync(800);
    expect(options.persistSession).toHaveBeenCalledTimes(2);
    instance.dispose();
  });

  it('autosaves within one second despite continuous edits', async () => {
    const tab = markdownTab();
    tabsState.set({ tabs: [tab], activeId: tab.id, ready: true });
    settingsStore.update((settings) => ({
      ...settings,
      files: { ...settings.files, autoSave: true },
    }));
    const { instance, options } = coordinator();

    instance.schedule(tab);
    await vi.advanceTimersByTimeAsync(900);
    instance.schedule(tab);
    await vi.advanceTimersByTimeAsync(100);
    expect(options.save).toHaveBeenCalledTimes(1);
    expect(options.save).toHaveBeenCalledWith(tab.id);

    instance.schedule(tab);
    await vi.advanceTimersByTimeAsync(1000);
    expect(options.save).toHaveBeenCalledTimes(2);
    instance.dispose();
  });

  it('keeps autosave timers independent per document', async () => {
    const first = markdownTab('first');
    const second = markdownTab('second');
    tabsState.set({ tabs: [first], activeId: first.id, ready: true });
    settingsStore.update((settings) => ({
      ...settings,
      files: { ...settings.files, autoSave: true },
    }));
    const { instance, options } = coordinator();

    await vi.advanceTimersByTimeAsync(500);
    tabsState.set({ tabs: [first, second], activeId: first.id, ready: true });
    instance.schedule(second);
    await vi.advanceTimersByTimeAsync(500);
    expect(options.save).toHaveBeenCalledTimes(1);
    expect(options.save).toHaveBeenCalledWith(first.id);
    await vi.advanceTimersByTimeAsync(500);
    expect(options.save).toHaveBeenLastCalledWith(second.id);
    instance.dispose();
  });

  it('cancels pending work when state no longer permits it', async () => {
    const tab = markdownTab();
    tabsState.set({ tabs: [tab], activeId: tab.id, ready: true });
    settingsStore.update((settings) => ({
      ...settings,
      files: { ...settings.files, autoSave: true },
    }));
    const { instance, options } = coordinator();

    instance.schedule(tab);
    tab.dirty = false;
    instance.schedule(tab);
    await vi.advanceTimersByTimeAsync(1000);
    expect(options.save).not.toHaveBeenCalled();

    tab.dirty = true;
    instance.schedule(tab);
    settingsStore.update((settings) => ({
      ...settings,
      files: { ...settings.files, autoSave: false },
    }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(options.save).not.toHaveBeenCalled();
    instance.dispose();
  });

  it('cancels delayed persistence when forced, flushed, or disposed', async () => {
    const direct = coordinator();
    direct.instance.scheduleSessionPersist();
    direct.instance.persistSession();
    expect(direct.options.persistSession).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(800);
    expect(direct.options.persistSession).toHaveBeenCalledTimes(1);
    direct.instance.dispose();

    const flushed = coordinator();
    flushed.instance.scheduleSessionPersist();
    await flushed.instance.flushSession();
    expect(flushed.options.flushSession).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(800);
    expect(flushed.options.persistSession).not.toHaveBeenCalled();
    flushed.instance.dispose();

    const disposed = coordinator();
    disposed.instance.scheduleSessionPersist();
    disposed.instance.dispose();
    await vi.advanceTimersByTimeAsync(800);
    expect(disposed.options.persistSession).not.toHaveBeenCalled();
  });
});
