import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ActivityBar from './sidebar/ActivityBar.svelte';
import FileTree from './sidebar/FileTree.svelte';
import Sidebar from './sidebar/Sidebar.svelte';
import SidebarContextMenu from './sidebar/SidebarContextMenu.svelte';
import { sidebarActions, sidebarState } from './sidebar/sidebarStore';
import type { FileNode } from './sidebar/workspace';
import TabBar from './tabs/TabBar.svelte';
import TabItem from './tabs/TabItem.svelte';
import { tabsState, type EditorTab } from './tabs/tabStore';
import { documentManager } from './editor/documentManager';

const settingsTab = (overrides: Partial<EditorTab> = {}): EditorTab =>
  ({
    id: 'settings',
    path: null,
    name: 'Settings',
    type: 'settings',
    pinned: false,
    dirty: false,
    missing: false,
    ...overrides,
  }) as EditorTab;

describe('navigation components', () => {
  beforeEach(() => {
    tabsState.set({ tabs: [], activeId: null, ready: true });
    sidebarState.set({
      visible: true,
      width: 240,
      activeView: 'explorer',
      workspacePath: null,
      workspaceName: null,
    });
  });

  it('runs activity bar actions', async () => {
    const user = userEvent.setup();
    const palette = vi.fn();
    const openSettings = vi.spyOn(documentManager, 'openSettings').mockReturnValue('settings');
    render(ActivityBar, { commandPaletteOpen: false, onOpenCommandPalette: palette });
    await user.click(screen.getByRole('button', { name: 'Explorer' }));
    expect(get(sidebarState).visible).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Command Palette' }));
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(palette).toHaveBeenCalled();
    expect(openSettings).toHaveBeenCalled();
  });

  it('renders nested file tree and forwards mouse and drag events', async () => {
    const handlers = {
      onActivate: vi.fn(),
      onContextMenu: vi.fn(),
      onDragStart: vi.fn(),
      onDragEnd: vi.fn(),
      onDragOver: vi.fn(),
      onDragLeave: vi.fn(),
      onDrop: vi.fn(),
    };
    const child: FileNode = {
      name: 'note.md',
      path: '/work/docs/note.md',
      isDirectory: false,
      type: 'markdown',
      expanded: false,
      loading: true,
      loaded: true,
      children: [],
    };
    const folder: FileNode = {
      name: 'docs',
      path: '/work/docs',
      isDirectory: true,
      type: null,
      expanded: true,
      loading: false,
      loaded: true,
      children: [child],
    };
    render(FileTree, {
      nodes: [folder],
      activePath: child.path,
      selectedPaths: new Set([folder.path]),
      draggedPaths: new Set([child.path]),
      dropTargetPath: folder.path,
      ...handlers,
    });
    const items = screen.getAllByRole('treeitem');
    expect(items).toHaveLength(2);
    await fireEvent.click(items[0]);
    await fireEvent.contextMenu(items[1]);
    await fireEvent.dragStart(items[1]);
    await fireEvent.dragOver(items[0]);
    await fireEvent.dragLeave(items[0]);
    await fireEvent.drop(items[0]);
    await fireEvent.dragEnd(items[1]);
    expect(handlers.onActivate).toHaveBeenCalledWith(folder, expect.any(MouseEvent));
    expect(handlers.onContextMenu).toHaveBeenCalledWith(child, expect.any(MouseEvent));
    expect(handlers.onDrop).toHaveBeenCalled();
    expect(screen.getByText('…')).toBeInTheDocument();
  });

  it('positions and navigates context menu', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(SidebarContextMenu, {
      x: 9999,
      y: 9999,
      items: [
        { id: 'rename', label: 'Rename' },
        { id: 'delete', label: 'Delete', danger: true, separatorBefore: true },
      ],
      onSelect,
      onClose,
    });
    const menu = screen.getByRole('menu', { hidden: true });
    await waitFor(() => expect(menu).toHaveStyle({ visibility: 'visible' }));
    await fireEvent.keyDown(window, { key: 'End' });
    await fireEvent.keyDown(window, { key: 'ArrowUp' });
    await fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Delete' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(onSelect).toHaveBeenCalledWith('delete');
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes context menus from global events and handles empty menus', async () => {
    const onClose = vi.fn();
    const empty = render(SidebarContextMenu, {
      x: 0,
      y: 0,
      items: [],
      onSelect: vi.fn(),
      onClose,
    });
    await fireEvent.keyDown(window, { key: 'ArrowDown' });
    await fireEvent.keyDown(window, { key: 'Home' });
    await fireEvent.keyDown(window, { key: 'Tab' });
    expect(onClose).toHaveBeenCalled();
    empty.unmount();

    render(SidebarContextMenu, {
      x: 1,
      y: 1,
      items: [{ id: 'one', label: 'One' }],
      onSelect: vi.fn(),
      onClose,
    });
    await fireEvent.pointerDown(document.body);
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('blur'));
    expect(onClose.mock.calls.length).toBeGreaterThan(3);
  });

  it('activates and closes tabs while exposing tab states', async () => {
    const user = userEvent.setup();
    const activate = vi.spyOn(documentManager, 'activate').mockImplementation(() => {});
    const close = vi.spyOn(documentManager, 'close').mockResolvedValue(true);
    const tab = settingsTab({ pinned: false, missing: true });
    render(TabItem, {
      tab,
      active: true,
      dragging: false,
      dropPosition: 'before',
      onDragStart: vi.fn(),
      onDragEnd: vi.fn(),
      onDragOver: vi.fn(),
      onDrop: vi.fn(),
      onContextMenu: vi.fn(),
      onError: vi.fn(),
    });
    await user.click(screen.getByRole('tab'));
    await fireEvent.keyDown(screen.getByRole('tab'), { key: 'Enter' });
    await fireEvent.keyDown(screen.getByRole('tab'), { key: 'x' });
    screen.getByRole('tab').dispatchEvent(new MouseEvent('auxclick', { button: 0, bubbles: true }));
    await user.click(screen.getByRole('button', { name: 'Close Settings' }));
    expect(activate).toHaveBeenCalledWith('settings');
    expect(close).toHaveBeenCalledWith('settings');
    expect(screen.getByTitle('Missing file')).toBeInTheDocument();
  });

  it('reorders and pins tabs through tab bar interactions', async () => {
    const first = settingsTab({ id: 'one', name: 'One' });
    const second = settingsTab({ id: 'two', name: 'Two' });
    tabsState.set({ tabs: [first, second], activeId: 'one', ready: true });
    const reorder = vi.spyOn(documentManager, 'reorderTab').mockImplementation(() => true);
    const pin = vi.spyOn(documentManager, 'setTabPinned').mockImplementation(() => true);
    render(TabBar, { onError: vi.fn() });
    const tabs = screen.getAllByRole('tab');
    const transfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    await fireEvent.dragStart(tabs[0], { dataTransfer: transfer });
    Object.defineProperty(tabs[1], 'getBoundingClientRect', {
      value: () => ({ left: 0, width: 100, right: 100, top: 0, bottom: 20 }),
    });
    await fireEvent.dragOver(tabs[1], { clientX: 10, dataTransfer: transfer });
    await fireEvent.drop(tabs[1], { dataTransfer: transfer });
    expect(reorder).toHaveBeenCalledWith('one', 'two', 'after');
    await fireEvent.contextMenu(tabs[0], { clientX: 5, clientY: 5 });
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Pin Tab' }));
    expect(pin).toHaveBeenCalledWith('one', true);
  });

  it('resizes and hides sidebar', async () => {
    tauriMocksForExplorer();
    const props = {
      onOpenFile: vi.fn(),
      onChangeWorkspace: vi.fn(),
      onBeforeDelete: vi.fn(),
      onDeleted: vi.fn(),
      onRenamed: vi.fn(),
      onError: vi.fn(),
    };
    render(Sidebar, props);
    const resizer = screen.getByRole('button', { name: 'Resize sidebar' });
    await fireEvent.pointerDown(resizer, { clientX: 100 });
    await fireEvent.pointerMove(window, { clientX: 200 });
    await fireEvent.pointerUp(window);
    expect(get(sidebarState).width).toBe(340);
    sidebarActions.toggle();
    await waitFor(() => expect(screen.queryByLabelText('Sidebar')).not.toBeInTheDocument());
  });

  it('renders every tab kind and handles auxiliary, keyboard, drag, and close errors', async () => {
    const activate = vi.spyOn(documentManager, 'activate').mockImplementation(() => {});
    vi.spyOn(documentManager, 'close').mockRejectedValue(new Error('close failed'));
    const onError = vi.fn();
    const callbacks = {
      onDragStart: vi.fn(),
      onDragEnd: vi.fn(),
      onDragOver: vi.fn(),
      onDrop: vi.fn(),
      onContextMenu: vi.fn(),
    };
    const kinds: EditorTab[] = [
      settingsTab({ id: 'image', type: 'image', path: '/work/a.png', name: 'a.png' }),
      settingsTab({ id: 'shortcuts', type: 'shortcuts', name: 'Shortcuts' }),
      settingsTab({ id: 'pinned', pinned: true, dirty: true, name: 'Pinned' }),
    ];
    for (const tab of kinds) {
      const view = render(TabItem, {
        tab,
        active: false,
        dragging: true,
        dropPosition: 'after',
        ...callbacks,
        onError,
      });
      const item = screen.getByRole('tab', { name: new RegExp(tab.name) });
      await fireEvent.keyDown(item, { key: ' ' });
      await fireEvent.doubleClick(item);
      await fireEvent.dragStart(item);
      await fireEvent.dragEnd(item);
      await fireEvent.dragOver(item);
      await fireEvent.drop(item);
      await fireEvent.contextMenu(item);
      if (!tab.pinned) {
        item.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true }));
      }
      view.unmount();
    }
    await waitFor(() => expect(onError).toHaveBeenCalledWith('close failed'));
    expect(activate).toHaveBeenCalled();
    expect(callbacks.onDragStart).toHaveBeenCalled();
  });

  it('reports non-Error tab close failures', async () => {
    vi.spyOn(documentManager, 'close').mockRejectedValue('plain close failure');
    const onError = vi.fn();
    render(TabItem, {
      tab: settingsTab(),
      active: false,
      dragging: false,
      dropPosition: null,
      onDragStart: vi.fn(),
      onDragEnd: vi.fn(),
      onDragOver: vi.fn(),
      onDrop: vi.fn(),
      onContextMenu: vi.fn(),
      onError,
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Close Settings' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('plain close failure'));
  });

  it('handles tab-bar wheel, invalid drags, group-end drops, and unpin context action', async () => {
    const pinned = settingsTab({ id: 'pinned', name: 'Pinned', pinned: true });
    const free = settingsTab({ id: 'free', name: 'Free' });
    tabsState.set({ tabs: [pinned, free], activeId: 'pinned', ready: true });
    const moveEnd = vi.spyOn(documentManager, 'moveTabToGroupEnd').mockImplementation(() => true);
    const pin = vi.spyOn(documentManager, 'setTabPinned').mockImplementation(() => true);
    const view = render(TabBar, { onError: vi.fn() });
    const bar = screen.getByRole('tablist');
    Object.defineProperty(bar, 'scrollLeft', { configurable: true, writable: true, value: 0 });
    await fireEvent.wheel(bar, { deltaY: 20, deltaX: 0 });
    expect((bar as HTMLElement).scrollLeft).toBe(20);
    const tabs = screen.getAllByRole('tab');
    const transfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    const noSourceTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    await fireEvent.dragOver(tabs[1], { dataTransfer: noSourceTransfer });
    expect(noSourceTransfer.dropEffect).toBe('none');
    await fireEvent.dragStart(tabs[0], { dataTransfer: transfer });
    await fireEvent.dragOver(tabs[1], { dataTransfer: transfer });
    expect(transfer.dropEffect).toBe('none');
    await fireEvent.dragOver(bar, { clientX: 999, dataTransfer: transfer });
    await fireEvent.dragLeave(bar, { relatedTarget: tabs[0] });
    await fireEvent.dragLeave(bar, { relatedTarget: document.body });
    await fireEvent.drop(bar, { dataTransfer: transfer });
    expect(moveEnd).toHaveBeenCalledWith('pinned');

    await fireEvent.contextMenu(tabs[0]);
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Unpin Tab' }));
    expect(pin).toHaveBeenCalledWith('pinned', false);

    const close = tabs[1].querySelector('.tab-close')!;
    await fireEvent.dragStart(close, { dataTransfer: transfer });
    expect(transfer.setData).toHaveBeenCalledTimes(1);
    await fireEvent.wheel(bar, { deltaY: 1, deltaX: 20 });
    view.unmount();
  });

  it('covers tab-bar edge scrolling, before drops, and empty drop states', async () => {
    const first = settingsTab({ id: 'first', name: 'First' });
    const second = settingsTab({ id: 'second', name: 'Second' });
    tabsState.set({ tabs: [first, second], activeId: 'first', ready: true });
    const reorder = vi.spyOn(documentManager, 'reorderTab').mockImplementation(() => true);
    const moveEnd = vi.spyOn(documentManager, 'moveTabToGroupEnd').mockImplementation(() => true);
    render(TabBar, { onError: vi.fn() });
    const bar = screen.getByRole('tablist');
    const tabs = screen.getAllByRole('tab');
    Object.defineProperty(bar, 'scrollLeft', { configurable: true, writable: true, value: 50 });
    Object.defineProperty(bar, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, right: 200, width: 200, top: 0, bottom: 20 }),
    });
    Object.defineProperty(tabs[1], 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 100, right: 200, width: 100, top: 0, bottom: 20 }),
    });
    const transfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    await fireEvent.dragStart(tabs[0], { dataTransfer: transfer });

    const before = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperties(before, {
      clientX: { value: 110 },
      dataTransfer: { value: transfer },
    });
    tabs[1].dispatchEvent(before);
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: transfer });
    tabs[1].dispatchEvent(drop);
    expect(reorder).toHaveBeenCalledWith('first', 'second', 'before');

    await fireEvent.dragStart(tabs[0], { dataTransfer: transfer });
    const leftEdge = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperties(leftEdge, {
      clientX: { value: 5 },
      dataTransfer: { value: transfer },
    });
    bar.dispatchEvent(leftEdge);
    expect((bar as HTMLElement).scrollLeft).toBe(36);
    expect(transfer.dropEffect).toBe('move');
    await fireEvent.drop(bar, { dataTransfer: transfer });
    expect(moveEnd).toHaveBeenCalledWith('first');

    moveEnd.mockClear();
    await fireEvent.drop(bar);
    expect(moveEnd).not.toHaveBeenCalled();
    await fireEvent.wheel(bar, { deltaY: 7, deltaX: 20, shiftKey: true });
    expect((bar as HTMLElement).scrollLeft).toBe(43);

    await fireEvent.dragStart(tabs[0]);
    await fireEvent.drop(tabs[1]);
    expect(reorder).toHaveBeenCalledTimes(1);
  });
});

function tauriMocksForExplorer(): void {
  // Explorer only reads filesystem after a workspace is selected.
  sidebarState.update((state) => ({ ...state, workspacePath: null }));
}
