<script lang="ts">
  import { onMount } from 'svelte';
  import { activeTab } from '../tabs/tabStore';
  import Explorer from './Explorer.svelte';
  import Search from './Search.svelte';
  import { MAX_WIDTH, MIN_WIDTH, sidebarActions, sidebarState } from './sidebarStore';

  type Props = {
    onOpenFile: (path: string) => Promise<boolean>;
    onChangeWorkspace: (path: string) => Promise<boolean>;
    onBeforeDelete: (path: string, isDirectory: boolean) => Promise<boolean>;
    onDeleted: (path: string, isDirectory: boolean) => void;
    onRenamed: (oldPath: string, newPath: string, isDirectory: boolean) => void;
    onError: (message: string) => void;
  };

  let { onOpenFile, onChangeWorkspace, onBeforeDelete, onDeleted, onRenamed, onError }: Props =
    $props();
  let dragWidth = $state<number | null>(null);
  let dragging = false;
  let startX = 0;
  let startWidth = 0;

  function beginResize(event: PointerEvent) {
    event.preventDefault();
    dragging = true;
    startX = event.clientX;
    startWidth = $sidebarState.width;
    dragWidth = startWidth;
    document.body.classList.add('resizing-sidebar');
  }

  function moveResize(event: PointerEvent) {
    if (!dragging) return;
    dragWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + event.clientX - startX));
  }

  function endResize() {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('resizing-sidebar');
    if (dragWidth !== null) sidebarActions.resize(dragWidth);
    dragWidth = null;
  }

  onMount(() => {
    window.addEventListener('pointermove', moveResize);
    window.addEventListener('pointerup', endResize);
    return () => {
      window.removeEventListener('pointermove', moveResize);
      window.removeEventListener('pointerup', endResize);
      document.body.classList.remove('resizing-sidebar');
    };
  });
</script>

{#if $sidebarState.visible}
  <aside class="sidebar" style:width={`${dragWidth ?? $sidebarState.width}px`} aria-label="Sidebar">
    <div class:hidden={$sidebarState.activeView !== 'explorer'} class="sidebar-view">
      <Explorer
        activePath={$activeTab?.path ?? null}
        {onOpenFile}
        {onChangeWorkspace}
        {onBeforeDelete}
        {onDeleted}
        {onRenamed}
        {onError}
      />
    </div>
    <div class:hidden={$sidebarState.activeView !== 'search'} class="sidebar-view">
      <Search {onOpenFile} {onError} />
    </div>
    <button
      class="sidebar-resizer"
      onpointerdown={beginResize}
      aria-label="Resize sidebar"
      title="Drag to resize"
    ></button>
  </aside>
{/if}
