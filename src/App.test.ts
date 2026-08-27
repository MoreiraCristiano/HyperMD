import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tauriMocks } from './test/tauriMocks';
import { documentManager } from './lib/editor/documentManager';
import { tabsState } from './lib/tabs/tabStore';
import { dialogService, resolveDialog } from './lib/dialogs/dialogStore';
import App from './App.svelte';

describe('App', () => {
  let closeHandler: ((event: { preventDefault: () => void }) => void) | undefined;
  let windowApi: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    tabsState.set({ tabs: [], activeId: null, ready: false });
    closeHandler = undefined;
    windowApi = {
      setTitle: vi.fn().mockResolvedValue(undefined),
      onCloseRequested: vi.fn(async (handler) => {
        closeHandler = handler;
        return vi.fn();
      }),
      onResized: vi.fn().mockResolvedValue(vi.fn()),
      isMaximized: vi.fn().mockResolvedValue(false),
      minimize: vi.fn().mockResolvedValue(undefined),
      maximize: vi.fn().mockResolvedValue(undefined),
      unmaximize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    tauriMocks.getCurrentWindow.mockReturnValue(windowApi);
    tauriMocks.getCurrentWebview.mockReturnValue({ setZoom: vi.fn().mockResolvedValue(undefined) });
  });

  it('mounts app, routes keyboard commands, palette actions, and window close', async () => {
    const user = userEvent.setup();
    const newDocument = vi.spyOn(documentManager, 'newDocument');
    const save = vi.spyOn(documentManager, 'save').mockResolvedValue(true);
    const close = vi.spyOn(documentManager, 'close').mockResolvedValue(true);
    const execute = vi.spyOn(documentManager, 'execute').mockResolvedValue(true);
    const openFind = vi.spyOn(documentManager, 'openFind').mockReturnValue(true);
    const activateRelative = vi.spyOn(documentManager, 'activateRelative');
    const activatePosition = vi.spyOn(documentManager, 'activatePosition');
    const persist = vi.spyOn(documentManager, 'persistSession');
    render(App);
    await waitFor(() => expect(tabsState).toBeDefined());
    await waitFor(() => expect(closeHandler).toBeDefined());

    const shortcut = async (key: string, extras = {}) =>
      fireEvent.keyDown(window, { key, ctrlKey: true, ...extras });
    await shortcut('n');
    await shortcut('s');
    await shortcut('s', { shiftKey: true });
    await shortcut('w');
    await shortcut('f');
    await shortcut('Tab');
    await shortcut('Tab', { shiftKey: true });
    await shortcut('1');
    await shortcut('b');
    expect(newDocument).toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith();
    expect(save).toHaveBeenCalledWith(undefined, true);
    expect(close).toHaveBeenCalled();
    expect(openFind).toHaveBeenCalled();
    expect(activateRelative).toHaveBeenCalledWith(1);
    expect(activateRelative).toHaveBeenCalledWith(-1);
    expect(activatePosition).toHaveBeenCalledWith(0);

    await shortcut('p', { shiftKey: true });
    expect(await screen.findByRole('dialog', { name: 'Command Palette' })).toBeInTheDocument();
    const search = screen.getByRole('searchbox', { name: 'Search commands' });
    await user.type(search, 'copy');
    await user.click(screen.getByRole('option', { name: /Copy/ }));
    expect(execute).toHaveBeenCalledWith('copy');

    const preventDefault = vi.fn();
    closeHandler?.({ preventDefault });
    await waitFor(() => expect(windowApi.destroy).toHaveBeenCalled());
    expect(preventDefault).toHaveBeenCalled();
    expect(persist).toHaveBeenCalled();
  });

  it('opens files, shows operation errors, and dismisses error toast', async () => {
    const user = userEvent.setup();
    vi.spyOn(documentManager, 'open').mockRejectedValue(new Error('cannot open'));
    tauriMocks.dialogOpen.mockResolvedValue('/work/a.md');
    render(App);
    await fireEvent.keyDown(window, { key: 'o', ctrlKey: true });
    const toast = await screen.findByRole('button', { name: 'Dismiss error' });
    expect(toast).toHaveTextContent('cannot open');
    await user.click(toast);
    expect(screen.queryByRole('button', { name: 'Dismiss error' })).not.toBeInTheDocument();
  });

  it('dispatches every command-palette command to its owner', async () => {
    const user = userEvent.setup();
    tauriMocks.dialogOpen.mockResolvedValue(null);
    vi.spyOn(documentManager, 'newDocument');
    vi.spyOn(documentManager, 'save').mockResolvedValue(true);
    vi.spyOn(documentManager, 'close').mockResolvedValue(true);
    vi.spyOn(documentManager, 'execute').mockResolvedValue(true);
    vi.spyOn(documentManager, 'openFind').mockReturnValue(true);
    vi.spyOn(documentManager, 'activateRelative');
    vi.spyOn(documentManager, 'openSettings');
    vi.spyOn(documentManager, 'openShortcuts');
    vi.spyOn(documentManager, 'canInsertTable').mockReturnValue(true);
    const insertTable = vi.spyOn(documentManager, 'insertTable').mockReturnValue(true);
    render(App);
    await waitFor(() => expect(closeHandler).toBeDefined());

    async function command(searchText: string, label: RegExp) {
      await fireEvent.keyDown(window, { key: 'p', ctrlKey: true, shiftKey: true });
      const input = await screen.findByRole('searchbox', { name: 'Search commands' });
      await user.clear(input);
      await user.type(input, searchText);
      const option = screen.getByRole('option', { name: label });
      expect(option).toBeEnabled();
      await user.click(option);
    }

    await command('new file', /New File/);
    await command('open file disk', /Open File/);
    await command('open folder workspace', /Open Folder/);
    await command('save active', /^Save File/);
    await command('save as', /Save As/);
    await command('close tab', /Close Tab/);
    await command('exit', /^Exit File/);
    await command('undo', /Undo/);
    await command('redo', /Redo/);
    await command('cut selected', /Cut/);
    await command('paste clipboard', /Paste/);
    await command('select all', /Select All/);
    await command('find document search', /Find in Document/);
    await command('next tab', /Next Tab/);
    await command('previous tab', /Previous Tab/);
    await command('toggle sidebar', /Toggle Sidebar/);
    await command('show explorer', /Show Explorer/);
    await command('zoom in', /Zoom In/);
    await command('zoom out', /Zoom Out/);
    await command('reset zoom', /Reset Zoom/);
    await command('insert table grid', /Insert Table/);
    expect(await screen.findByRole('dialog', { name: 'Insert Table' })).toBeInTheDocument();
    await user.click(screen.getByRole('gridcell', { name: '3 columns by 4 rows' }));
    await command('open settings', /Open Settings/);
    await command('keyboard shortcuts bindings', /Keyboard Shortcuts/);

    expect(documentManager.execute).toHaveBeenCalledWith('paste');
    expect(insertTable).toHaveBeenCalledWith(4, 3);
    expect(documentManager.openSettings).toHaveBeenCalled();
    expect(documentManager.openShortcuts).toHaveBeenCalled();
    expect(windowApi.close).toHaveBeenCalled();
  }, 15_000);

  it('blocks app shortcuts during dialogs and cancels dirty window close', async () => {
    windowApi.setTitle.mockRejectedValue(new Error('title unavailable'));
    const newDocument = vi.spyOn(documentManager, 'newDocument');
    const prepare = vi.spyOn(documentManager, 'prepareWindowClose').mockResolvedValue(false);
    render(App);
    await waitFor(() => expect(closeHandler).toBeDefined());
    const pending = dialogService.confirm({ title: 'Blocking', message: 'Wait' });
    const event = new KeyboardEvent('keydown', {
      key: 'n',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(newDocument).toHaveBeenCalledTimes(1);
    resolveDialog('cancel');
    await pending;

    const tab = tabsState;
    tab.update((state) => ({
      ...state,
      tabs: state.tabs.map((item) => (item.type === 'markdown' ? { ...item, dirty: true } : item)),
    }));
    closeHandler?.({ preventDefault: vi.fn() });
    await waitFor(() => expect(prepare).toHaveBeenCalled());
    expect(windowApi.destroy).not.toHaveBeenCalled();
    await waitFor(() => expect(document.title).toContain('HyperMD'));
  });
});
