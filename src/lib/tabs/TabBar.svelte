<script lang="ts">
  import { documentManager } from '../editor/documentManager';
  import SidebarContextMenu, { type ContextMenuItem } from '../sidebar/SidebarContextMenu.svelte';
  import TabItem from './TabItem.svelte';
  import { tabsState, type EditorTab } from './tabStore';

  type Props = { onError: (message: string) => void };
  type DropState = { targetId: string; position: 'before' | 'after' };
  type ContextMenuState = { tab: EditorTab; x: number; y: number };

  let { onError }: Props = $props();
  let scroller: HTMLDivElement;
  let draggedId = $state<string | null>(null);
  let dropState = $state<DropState | null>(null);
  let dropAtEnd = $state(false);
  let contextMenu = $state<ContextMenuState | null>(null);

  function horizontalWheel(event: WheelEvent) {
    if (!scroller || (!event.shiftKey && Math.abs(event.deltaX) >= Math.abs(event.deltaY))) return;
    event.preventDefault();
    scroller.scrollLeft += event.deltaY;
  }

  function scrollNearEdge(clientX: number) {
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    const edge = 30;
    if (clientX < rect.left + edge) scroller.scrollLeft -= 14;
    else if (clientX > rect.right - edge) scroller.scrollLeft += 14;
  }

  function draggedTab(): EditorTab | null {
    return $tabsState.tabs.find((tab) => tab.id === draggedId) ?? null;
  }

  function beginDrag(tab: EditorTab, event: DragEvent) {
    const target = event.target;
    if (target instanceof Element && target.closest('.tab-close')) {
      event.preventDefault();
      return;
    }
    draggedId = tab.id;
    dropState = null;
    dropAtEnd = false;
    contextMenu = null;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('application/x-hypermd-tab', tab.id);
    }
  }

  function endDrag() {
    draggedId = null;
    dropState = null;
    dropAtEnd = false;
  }

  function dragOverTab(tab: EditorTab, event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    scrollNearEdge(event.clientX);
    const source = draggedTab();
    const valid = Boolean(source && source.id !== tab.id && source.pinned === tab.pinned);
    if (!valid || !(event.currentTarget instanceof HTMLElement)) {
      dropState = null;
      dropAtEnd = false;
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    dropState = {
      targetId: tab.id,
      position: event.clientX < rect.left + rect.width / 2 ? 'before' : 'after',
    };
    dropAtEnd = false;
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  function dropOnTab(tab: EditorTab, event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    const sourceId = draggedId;
    const position = dropState?.targetId === tab.id ? dropState.position : null;
    endDrag();
    if (sourceId && position) documentManager.reorderTab(sourceId, tab.id, position);
  }

  function dragOverBar(event: DragEvent) {
    event.preventDefault();
    scrollNearEdge(event.clientX);
    const source = draggedTab();
    if (!source) {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
      return;
    }
    const firstUnpinned = $tabsState.tabs.find((tab) => !tab.pinned);
    if (source.pinned && firstUnpinned) {
      dropState = { targetId: firstUnpinned.id, position: 'before' };
      dropAtEnd = false;
    } else {
      dropState = null;
      dropAtEnd = true;
    }
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  function leaveBar(event: DragEvent) {
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget instanceof Node) {
      if (event.currentTarget.contains(related)) return;
    }
    dropState = null;
    dropAtEnd = false;
  }

  function dropOnBar(event: DragEvent) {
    event.preventDefault();
    const sourceId = draggedId;
    endDrag();
    if (sourceId) documentManager.moveTabToGroupEnd(sourceId);
  }

  function openContextMenu(tab: EditorTab, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    endDrag();
    contextMenu = { tab, x: event.clientX, y: event.clientY };
  }

  function contextItems(tab: EditorTab): readonly ContextMenuItem[] {
    return [{ id: tab.pinned ? 'unpin' : 'pin', label: tab.pinned ? 'Unpin Tab' : 'Pin Tab' }];
  }

  function executeContextAction(action: string) {
    const tab = contextMenu?.tab;
    contextMenu = null;
    if (!tab) return;
    if (action === 'pin') documentManager.setTabPinned(tab.id, true);
    else if (action === 'unpin') documentManager.setTabPinned(tab.id, false);
  }
</script>

<div
  class="tab-bar"
  class:drop-at-end={dropAtEnd}
  bind:this={scroller}
  data-tauri-drag-region
  onwheel={horizontalWheel}
  ondragover={dragOverBar}
  ondragleave={leaveBar}
  ondrop={dropOnBar}
  role="tablist"
  aria-label="Open files"
  tabindex="-1"
>
  {#each $tabsState.tabs as tab (tab.id)}
    <TabItem
      {tab}
      active={tab.id === $tabsState.activeId}
      dragging={tab.id === draggedId}
      dropPosition={dropState?.targetId === tab.id ? dropState.position : null}
      onDragStart={beginDrag}
      onDragEnd={endDrag}
      onDragOver={dragOverTab}
      onDrop={dropOnTab}
      onContextMenu={openContextMenu}
      {onError}
    />
  {/each}
</div>

{#if contextMenu}
  <SidebarContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    items={contextItems(contextMenu.tab)}
    ariaLabel="Tab actions"
    onSelect={executeContextAction}
    onClose={() => (contextMenu = null)}
  />
{/if}
