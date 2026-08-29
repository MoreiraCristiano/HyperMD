<script lang="ts">
  import { documentManager } from '../documentManager';
  import type { EditorTab } from './tabStore';

  type Props = {
    tab: EditorTab;
    active: boolean;
    dragging: boolean;
    dropPosition: 'before' | 'after' | null;
    onDragStart: (tab: EditorTab, event: DragEvent) => void;
    onDragEnd: () => void;
    onDragOver: (tab: EditorTab, event: DragEvent) => void;
    onDrop: (tab: EditorTab, event: DragEvent) => void;
    onContextMenu: (tab: EditorTab, event: MouseEvent) => void;
    onError: (message: string) => void;
  };

  let {
    tab,
    active,
    dragging,
    dropPosition,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDrop,
    onContextMenu,
    onError,
  }: Props = $props();
  let element: HTMLDivElement;

  $effect(() => {
    if (active && element) element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  function close(event: MouseEvent) {
    event.stopPropagation();
    void documentManager
      .close(tab.id)
      .catch((cause) => onError(cause instanceof Error ? cause.message : String(cause)));
  }
</script>

<div
  bind:this={element}
  class="tab-item"
  class:active
  class:missing={tab.missing}
  class:pinned={tab.pinned}
  class:dragging
  class:drop-before={dropPosition === 'before'}
  class:drop-after={dropPosition === 'after'}
  draggable="true"
  onclick={() => documentManager.activate(tab.id)}
  ondragstart={(event) => onDragStart(tab, event)}
  ondragend={onDragEnd}
  ondragover={(event) => onDragOver(tab, event)}
  ondrop={(event) => onDrop(tab, event)}
  oncontextmenu={(event) => onContextMenu(tab, event)}
  onkeydown={(event) => {
    if (event.key === 'Enter' || event.key === ' ') documentManager.activate(tab.id);
  }}
  ondblclick={() => documentManager.activate(tab.id)}
  onauxclick={(event) => {
    if (event.button === 1) close(event);
  }}
  title={`${tab.path ?? tab.name}${tab.pinned ? ' — pinned' : ''}${tab.missing ? ' — missing file' : ''}`}
  role="tab"
  aria-selected={active}
  tabindex={active ? 0 : -1}
>
  {#if tab.type === 'image'}
    <svg class="tab-type-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 2.5h12v11H2zM4.5 5.5h.01M3.5 11l3-3 2 2 1.5-1.5 2.5 2.5" />
    </svg>
  {:else if tab.type === 'settings'}
    <svg class="tab-type-icon settings" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="2" />
      <path
        d="M12.7 8a5 5 0 0 0-.1-1l1.2-.9-1.2-2-1.4.6a5 5 0 0 0-1-.6L10 2.5H7.7l-.2 1.6a5 5 0 0 0-1 .6l-1.4-.6-1.2 2 1.2.9a5 5 0 0 0 0 2l-1.2.9 1.2 2 1.4-.6a5 5 0 0 0 1 .6l.2 1.6H10l.2-1.6a5 5 0 0 0 1-.6l1.4.6 1.2-2-1.2-.9a5 5 0 0 0 .1-1z"
      />
    </svg>
  {:else if tab.type === 'shortcuts'}
    <svg class="tab-type-icon shortcuts" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="3" width="13" height="10" rx="1.5" />
      <path d="M4 6h1m2 0h1m2 0h1M4 9h1m2 0h1m2 0h1M5 11h6" />
    </svg>
  {/if}
  {#if tab.pinned}
    <svg class="tab-pin" viewBox="0 0 16 16" aria-hidden="true">
      <path d="m5 2 6 2-1.5 2.2.8 2.8-2.2 2.2-2.8-.8L3 11l2-2-1-4zM8 10l-3 4" />
    </svg>
  {/if}
  <span class="tab-name">{tab.name}</span>
  {#if tab.missing}<span class="tab-missing" title="Missing file">!</span>{/if}
  {#if tab.dirty}<span class="tab-dirty" title="Unsaved changes">●</span>{/if}
  {#if !tab.pinned}
    <button
      class="tab-close"
      draggable="false"
      onclick={close}
      title="Close"
      aria-label={`Close ${tab.name}`}
    >
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 3 6 6m0-6L3 9" /></svg>
    </button>
  {/if}
</div>
