<script lang="ts">
  import { tick } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import type { EditorCommand } from '../editor/editorTypes';
  import { activeTab } from '../tabs/tabStore';
  import AppMenu, { type MenuItem } from './AppMenu.svelte';
  import WindowControls from './WindowControls.svelte';

  type MenuName = 'file' | 'edit' | 'view';
  type Action = () => unknown | Promise<unknown>;
  type Props = {
    onNew: Action;
    onOpen: Action;
    onOpenFolder: Action;
    onSave: Action;
    onSaveAs: Action;
    onCloseTab: Action;
    onExit: () => void | Promise<void>;
    onEdit: (command: EditorCommand) => void | Promise<unknown>;
    onToggleSidebar: Action;
    onExplorer: Action;
    onSearch: Action;
    onZoomIn: Action;
    onZoomOut: Action;
    onResetZoom: Action;
    onError: (message: string) => void;
  };

  let {
    onNew,
    onOpen,
    onOpenFolder,
    onSave,
    onSaveAs,
    onCloseTab,
    onExit,
    onEdit,
    onToggleSidebar,
    onExplorer,
    onSearch,
    onZoomIn,
    onZoomOut,
    onResetZoom,
    onError,
  }: Props = $props();

  let openMenu = $state<MenuName | null>(null);

  const fileItems: MenuItem[] = [
    { label: 'New File', shortcut: 'Ctrl+N', action: () => onNew() },
    { label: 'Open File…', shortcut: 'Ctrl+O', action: () => onOpen() },
    { label: 'Open Folder…', action: () => onOpenFolder() },
    { separator: true },
    { label: 'Save', shortcut: 'Ctrl+S', action: () => onSave() },
    { label: 'Save As…', shortcut: 'Ctrl+Shift+S', action: () => onSaveAs() },
    { separator: true },
    { label: 'Close Tab', shortcut: 'Ctrl+W', action: () => onCloseTab() },
    { label: 'Exit', action: () => onExit() },
  ];
  const editItems: MenuItem[] = [
    { label: 'Undo', shortcut: 'Ctrl+Z', action: () => onEdit('undo') },
    { label: 'Redo', shortcut: 'Ctrl+Y', action: () => onEdit('redo') },
    { separator: true },
    { label: 'Cut', shortcut: 'Ctrl+X', action: () => onEdit('cut') },
    { label: 'Copy', shortcut: 'Ctrl+C', action: () => onEdit('copy') },
    { label: 'Paste', shortcut: 'Ctrl+V', action: () => onEdit('paste') },
    { separator: true },
    { label: 'Select All', shortcut: 'Ctrl+A', action: () => onEdit('selectAll') },
  ];
  const viewItems: MenuItem[] = [
    { label: 'Toggle Sidebar', shortcut: 'Ctrl+B', action: () => onToggleSidebar() },
    { label: 'Explorer', action: () => onExplorer() },
    { label: 'Search', action: () => onSearch() },
    { separator: true },
    { label: 'Zoom In', action: () => onZoomIn() },
    { label: 'Zoom Out', action: () => onZoomOut() },
    { label: 'Reset Zoom', action: () => onResetZoom() },
  ];

  function itemsFor(menu: MenuName): MenuItem[] {
    if (menu === 'file') return fileItems;
    if (menu === 'edit') return editItems;
    return viewItems;
  }

  async function toggleMenu(menu: MenuName, event: MouseEvent) {
    event.stopPropagation();
    openMenu = openMenu === menu ? null : menu;
    if (openMenu) {
      await tick();
      document.querySelector<HTMLButtonElement>('.app-menu button:not(:disabled)')?.focus();
    }
  }

  function switchMenu(menu: MenuName) {
    if (openMenu && openMenu !== menu) openMenu = menu;
  }

  async function toggleMaximize() {
    const appWindow = getCurrentWindow();
    try {
      if (await appWindow.isMaximized()) await appWindow.unmaximize();
      else await appWindow.maximize();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') openMenu = null;
  }
</script>

<svelte:window onclick={() => (openMenu = null)} onkeydown={handleWindowKeydown} />

<header class="title-bar">
  <div class="title-left">
    <div class="app-mark" data-tauri-drag-region aria-hidden="true">
      <svg viewBox="0 0 20 20"><path d="M3 4h4l3 4.5L13 4h4v12h-3v-7l-4 5.5L6 9v7H3z" /></svg>
    </div>
    <nav class="app-menu-bar" aria-label="Menu principal">
      {#each ['file', 'edit', 'view'] as menu (menu)}
        <div class="menu-anchor">
          <button
            class:open={openMenu === menu}
            onmouseenter={() => switchMenu(menu as MenuName)}
            onclick={(event) => toggleMenu(menu as MenuName, event)}
            aria-haspopup="menu"
            aria-expanded={openMenu === menu}
          >
            {menu === 'file' ? 'File' : menu === 'edit' ? 'Edit' : 'View'}
          </button>
          {#if openMenu === menu}
            <AppMenu
              items={itemsFor(menu as MenuName)}
              onClose={() => (openMenu = null)}
              {onError}
            />
          {/if}
        </div>
      {/each}
    </nav>
    <div
      class="title-drag-fill"
      data-tauri-drag-region
      role="presentation"
      ondblclick={toggleMaximize}
    ></div>
  </div>

  <div
    class="window-title"
    data-tauri-drag-region
    role="presentation"
    ondblclick={toggleMaximize}
    title={$activeTab?.path ?? 'HyperMD'}
  >
    {#if $activeTab?.dirty}<span class="title-dirty" aria-label="Alterações não salvas">●</span
      >{/if}
    <span>{$activeTab ? `${$activeTab.name} — HyperMD` : 'HyperMD'}</span>
  </div>

  <div class="title-right">
    <div
      class="title-drag-fill"
      data-tauri-drag-region
      role="presentation"
      ondblclick={toggleMaximize}
    ></div>
    <WindowControls {onError} onClose={onExit} />
  </div>
</header>
