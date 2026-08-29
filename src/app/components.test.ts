import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tauriMocks } from '@/test/tauriMocks';
import CommandPalette from '@/app/components/CommandPalette.svelte';
import DialogHost from '@/shared/ui/dialogs/DialogHost.svelte';
import { dialogService, resolveDialog } from '@/shared/ui/dialogs';
import ImageViewer from '@/features/documents/viewers/ImageViewer.svelte';
import { SettingsView } from '@/features/settings';
import { settingsActions, settingsStore } from '@/features/settings/settingsStore';
import KeyboardShortcutsView from '@/app/components/shortcuts/KeyboardShortcutsView.svelte';
import { sidebarState } from '@/features/workspace/workspaceStore';
import WindowControls from '@/app/components/titlebar/WindowControls.svelte';
import TablePicker from '@/features/documents/editor/TablePicker.svelte';

describe('front-end components', () => {
  beforeEach(() => {
    settingsActions.reset();
    sidebarState.set({
      ...get(sidebarState),
      workspacePath: '/work',
      workspaceName: 'Work',
    });
  });

  it('filters, navigates, executes, and closes the command palette', async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    const onClose = vi.fn();
    render(CommandPalette, {
      open: true,
      isEnabled: (id) => id !== 'file.new',
      onExecute,
      onClose,
    });
    const search = screen.getByRole('searchbox', { name: 'Search commands' });
    await user.type(search, 'open folder');
    await user.click(screen.getByRole('option', { name: /Open Folder/ }));
    expect(onExecute).toHaveBeenCalledWith('file.openFolder');
    expect(onClose).toHaveBeenCalled();

    await user.clear(search);
    await user.type(search, 'not-present');
    expect(screen.getByText('No matching commands')).toBeInTheDocument();
    await fireEvent.keyDown(search, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('supports keyboard movement and ignores disabled command execution', async () => {
    const onExecute = vi.fn();
    render(CommandPalette, {
      open: true,
      isEnabled: (id) => id !== 'file.new',
      onExecute,
      onClose: vi.fn(),
    });
    const search = screen.getByRole('searchbox');
    await fireEvent.keyDown(search, { key: 'ArrowDown' });
    await fireEvent.keyDown(search, { key: 'ArrowUp' });
    await fireEvent.keyDown(search, { key: 'Enter' });
    expect(onExecute).toHaveBeenCalled();
    expect(screen.getByRole('option', { name: /New File/ })).toBeDisabled();
  });

  it('selects table dimensions with pointer and keyboard', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const view = render(TablePicker, { open: true, onSelect, onClose });
    const fourByThree = screen.getByRole('gridcell', { name: '3 columns by 4 rows' });
    await fireEvent.mouseEnter(fourByThree);
    expect(screen.getByText('3 columns × 4 rows')).toBeInTheDocument();
    expect(view.container.querySelectorAll('.table-picker-grid .highlighted')).toHaveLength(12);
    await fireEvent.click(fourByThree);
    expect(onSelect).toHaveBeenCalledWith(4, 3);

    const first = screen.getByRole('gridcell', { name: '1 column by 1 row' });
    first.focus();
    await fireEvent.keyDown(first, { key: 'ArrowRight' });
    await fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    await fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith(2, 2);
    await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();

    const backdrop = view.container.querySelector('.table-picker-backdrop')!;
    await fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('renders dialogs, validates required prompts, and restores queue order', async () => {
    const user = userEvent.setup();
    render(DialogHost);
    const result = dialogService.prompt({
      title: 'Create file',
      label: 'Name',
      required: true,
      placeholder: 'note.md',
    });
    const input = await screen.findByLabelText('Name');
    const confirm = screen.getByRole('button', { name: 'OK' });
    expect(confirm).toBeDisabled();
    await user.type(input, 'note.md');
    expect(confirm).toBeEnabled();
    await user.keyboard('{Enter}');
    await expect(result).resolves.toBe('note.md');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const choice = dialogService.choose({
      title: 'Choose',
      message: 'Action?',
      actions: [{ id: 'keep', label: 'Keep' }],
    });
    await user.click(await screen.findByRole('button', { name: 'Keep' }));
    await expect(choice).resolves.toBe('keep');
  });

  it('cancels dialogs using Escape and backdrop', async () => {
    render(DialogHost);
    const first = dialogService.confirm({ title: 'Confirm', message: 'Continue?' });
    await screen.findByRole('dialog');
    await fireEvent.keyDown(window, { key: 'Escape' });
    await expect(first).resolves.toBe(false);
    const second = dialogService.confirm({ title: 'Confirm again', message: 'Continue?' });
    const dialog = await screen.findByRole('dialog');
    await fireEvent.click(dialog.parentElement!);
    await expect(second).resolves.toBe(false);
    resolveDialog(null);
  });

  it('updates every settings group and confirms reset', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(dialogService, 'confirm').mockResolvedValue(true);
    const reset = vi.spyOn(settingsActions, 'reset');
    render(SettingsView);

    await user.selectOptions(screen.getByLabelText('Theme'), 'light');
    expect(get(settingsStore).appearance.theme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');

    const uiFont = screen.getByLabelText('UI Font');
    await user.clear(uiFont);
    await user.type(uiFont, 'Arial');
    expect(get(settingsStore).appearance.uiFontFamily).toBe('Arial');

    const numbers = screen.getAllByRole('spinbutton');
    await fireEvent.change(numbers[0], { target: { value: '18' } });
    await fireEvent.change(numbers[1], { target: { value: '20' } });
    await fireEvent.change(numbers[2], { target: { value: '2' } });
    expect(get(settingsStore).appearance.uiFontSize).toBe(18);
    expect(get(settingsStore).editor.fontSize).toBe(20);

    await user.selectOptions(screen.getByLabelText('Content Width'), 'full');
    const switches = screen.getAllByRole('switch');
    await user.click(switches[0]);
    await user.click(switches[1]);
    expect(get(settingsStore).editor.maxWidth).toBeNull();
    expect(get(settingsStore).editor.wordWrap).toBe(false);
    expect(get(settingsStore).files.autoSave).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Reset to Defaults' }));
    expect(confirm).toHaveBeenCalled();
    expect(reset).toHaveBeenCalled();
  });

  it('renders categorized keyboard shortcuts', () => {
    render(KeyboardShortcutsView);
    expect(screen.getByRole('heading', { name: 'Keyboard Shortcuts' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'General' })).toBeInTheDocument();
    expect(screen.getAllByText('Ctrl+Shift+P').length).toBeGreaterThan(0);
  });

  it('loads image viewer and supports zoom keyboard and toolbar controls', async () => {
    tauriMocks.stat.mockResolvedValue({ isFile: true });
    const view = render(ImageViewer, { path: '/work/a.png' });
    await waitFor(() => expect(view.container.querySelector('img')).not.toBeNull());
    const image = view.container.querySelector('img')!;
    expect(image).toHaveAttribute('src', 'asset:///work/a.png');
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 640 },
      naturalHeight: { configurable: true, value: 480 },
    });
    await fireEvent.load(image);
    await fireEvent.click(screen.getByRole('button', { name: '100%' }));
    expect(image).toHaveStyle({ width: '640px', height: '480px' });
    await fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('125%')).toBeInTheDocument();
    await fireEvent.keyDown(window, { key: '-', ctrlKey: true });
    expect(screen.getAllByText('100%').length).toBeGreaterThan(0);
    await fireEvent.click(screen.getByRole('button', { name: 'Fit' }));
    expect(screen.getAllByText('Fit').length).toBeGreaterThan(0);
    await fireEvent.error(image);
    expect(screen.getByText('Could not load this image.')).toBeInTheDocument();
  });

  it('shows image viewer workspace and missing-file errors', async () => {
    sidebarState.update((state) => ({ ...state, workspacePath: null }));
    const view = render(ImageViewer, { path: '/work/a.png' });
    expect(await screen.findByText('Reopen the workspace to view this image.')).toBeInTheDocument();
    view.unmount();
    sidebarState.update((state) => ({ ...state, workspacePath: '/work' }));
    render(ImageViewer, { path: '/work/a.png', missing: true });
    expect(
      await screen.findByText('The file no longer exists in the workspace.'),
    ).toBeInTheDocument();
  });

  it('runs window controls, reflects maximize state, and reports failures', async () => {
    const user = userEvent.setup();
    const windowApi = {
      minimize: vi.fn().mockResolvedValue(undefined),
      maximize: vi.fn().mockResolvedValue(undefined),
      unmaximize: vi.fn().mockResolvedValue(undefined),
      isMaximized: vi.fn().mockResolvedValue(false),
      onResized: vi.fn().mockResolvedValue(vi.fn()),
    };
    tauriMocks.getCurrentWindow.mockReturnValue(windowApi);
    const onClose = vi.fn();
    const onError = vi.fn();
    render(WindowControls, { onClose, onError });
    await user.click(screen.getByRole('button', { name: 'Minimize' }));
    await user.click(screen.getByRole('button', { name: 'Maximize' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(windowApi.minimize).toHaveBeenCalled();
    expect(windowApi.maximize).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    windowApi.minimize.mockRejectedValueOnce(new Error('denied'));
    await user.click(screen.getByRole('button', { name: 'Minimize' }));
    expect(onError).toHaveBeenCalledWith('denied');
  });

  it('covers command palette backdrop, blocked shortcuts, disabled set, and empty movement', async () => {
    const onClose = vi.fn();
    const view = render(CommandPalette, {
      open: true,
      isEnabled: () => false,
      onExecute: vi.fn(),
      onClose,
    });
    const input = screen.getByRole('searchbox');
    const blocked = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(blocked);
    expect(blocked.defaultPrevented).toBe(true);
    await fireEvent.input(input, { target: { value: 'no-results' } });
    await fireEvent.keyDown(input, { key: 'ArrowDown' });
    await fireEvent.keyDown(input, { key: 'Enter' });
    const backdrop = view.container.querySelector('.command-palette-backdrop')!;
    await fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('cycles dialog focus and supports cancel buttons', async () => {
    render(DialogHost);
    const result = dialogService.confirm({ title: 'Focus', message: 'Cycle?' });
    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    cancel.focus();
    await fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
    await fireEvent.keyDown(window, { key: 'Tab' });
    expect(cancel).toHaveFocus();
    await fireEvent.click(cancel);
    await expect(result).resolves.toBe(false);
  });

  it('updates remaining settings fields and leaves values when reset is cancelled', async () => {
    const user = userEvent.setup();
    vi.spyOn(dialogService, 'confirm').mockResolvedValue(false);
    render(SettingsView);
    const editorFont = screen.getByLabelText('Editor Font');
    const codeFont = screen.getByLabelText('Code Block Font');
    await user.clear(editorFont);
    await user.type(editorFont, 'Editor Font');
    await user.clear(codeFont);
    await user.type(codeFont, 'Code Font');
    await user.selectOptions(screen.getByLabelText('Content Width'), '1200');
    await user.click(screen.getByRole('button', { name: 'Reset to Defaults' }));
    expect(get(settingsStore).editor).toMatchObject({
      fontFamily: 'Editor Font',
      codeBlockFontFamily: 'Code Font',
      maxWidth: 1200,
    });
  });

  it('clamps image viewer zoom levels and reports loader failures', async () => {
    tauriMocks.stat.mockRejectedValueOnce(new Error('image denied'));
    const failed = render(ImageViewer, { path: '/work/fail.png' });
    expect(await screen.findByText('image denied')).toBeInTheDocument();
    failed.unmount();

    tauriMocks.stat.mockResolvedValue({ isFile: true });
    render(ImageViewer, { path: '/work/a.png' });
    await waitFor(() => expect(document.querySelector('.image-canvas')).not.toBeNull());
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' });
    const zoomOut = screen.getByRole('button', { name: 'Zoom out' });
    for (let index = 0; index < 15; index += 1) await fireEvent.click(zoomIn);
    expect(screen.getByText('500%')).toBeInTheDocument();
    for (let index = 0; index < 20; index += 1) await fireEvent.click(zoomOut);
    expect(screen.getByText('10%')).toBeInTheDocument();
    await fireEvent.keyDown(window, { key: '0', metaKey: true });
    expect(screen.getAllByText('Fit').length).toBeGreaterThan(0);
    const harmless = new KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true });
    window.dispatchEvent(harmless);
    expect(harmless.defaultPrevented).toBe(false);
    await fireEvent.keyDown(window, { key: '=', ctrlKey: true });
    expect(screen.getByText('125%')).toBeInTheDocument();
  });

  it('reports non-Error image loader failures and ignores unrelated commands', async () => {
    tauriMocks.stat.mockRejectedValueOnce('plain image failure');
    render(ImageViewer, { path: '/work/fail.png' });
    expect(await screen.findByText('plain image failure')).toBeInTheDocument();
    const unrelated = new KeyboardEvent('keydown', {
      key: 'x',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(unrelated);
    expect(unrelated.defaultPrevented).toBe(false);
  });

  it('syncs maximized window state after resize and unlistens on destroy', async () => {
    vi.useFakeTimers();
    const unlisten = vi.fn();
    let resized: (() => void) | undefined;
    const windowApi = {
      minimize: vi.fn().mockResolvedValue(undefined),
      maximize: vi.fn().mockResolvedValue(undefined),
      unmaximize: vi.fn().mockResolvedValue(undefined),
      isMaximized: vi.fn().mockResolvedValue(true),
      onResized: vi.fn(async (handler: () => void) => {
        resized = handler;
        return unlisten;
      }),
    };
    tauriMocks.getCurrentWindow.mockReturnValue(windowApi);
    const view = render(WindowControls, { onClose: vi.fn(), onError: vi.fn() });
    await vi.runAllTimersAsync();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
    resized?.();
    await vi.advanceTimersByTimeAsync(80);
    view.unmount();
    expect(unlisten).toHaveBeenCalled();
  });

  it('restores maximized windows and reports non-Error control failures', async () => {
    const windowApi = {
      minimize: vi.fn().mockRejectedValue('minimize denied'),
      maximize: vi.fn(),
      unmaximize: vi.fn().mockResolvedValue(undefined),
      isMaximized: vi.fn().mockResolvedValue(true),
      onResized: vi.fn().mockRejectedValue('listener denied'),
    };
    tauriMocks.getCurrentWindow.mockReturnValue(windowApi);
    const onClose = vi.fn().mockRejectedValue('close denied');
    const onError = vi.fn();
    render(WindowControls, { onClose, onError });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument(),
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Minimize' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(windowApi.unmaximize).toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith('listener denied');
      expect(onError).toHaveBeenCalledWith('minimize denied');
      expect(onError).toHaveBeenCalledWith('close denied');
    });
  });
});
