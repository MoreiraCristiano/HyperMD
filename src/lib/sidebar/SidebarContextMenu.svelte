<script lang="ts">
  import { onMount, tick } from 'svelte';

  export type ContextMenuItem = {
    id: string;
    label: string;
    danger?: boolean;
    disabled?: boolean;
    separatorBefore?: boolean;
  };
  export type SidebarContextMenuItem = ContextMenuItem;

  type Props = {
    x: number;
    y: number;
    items: readonly ContextMenuItem[];
    ariaLabel?: string;
    onSelect: (id: string) => void;
    onClose: () => void;
  };

  let { x, y, items, ariaLabel = 'Context actions', onSelect, onClose }: Props = $props();
  let panel = $state<HTMLDivElement>();
  let left = $state(0);
  let top = $state(0);
  let activeId = $state<string | null>(null);
  let positioned = $state(false);

  function buttons(): HTMLButtonElement[] {
    return panel
      ? Array.from(panel.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'))
      : [];
  }

  function focusAt(index: number): void {
    const available = buttons();
    if (available.length === 0) return;
    const button = available[(index + available.length) % available.length];
    activeId = button.dataset.contextMenuId ?? null;
    button.focus();
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      const available = buttons();
      focusAt(available.findIndex((button) => button.dataset.contextMenuId === activeId) + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const available = buttons();
      const current = available.findIndex((button) => button.dataset.contextMenuId === activeId);
      focusAt((current === -1 ? 0 : current) - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusAt(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusAt(buttons().length - 1);
    }
  }

  $effect(() => {
    x;
    y;
    items;
    left = x;
    top = y;
    activeId = null;
    positioned = false;
    void tick().then(() => {
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      left = Math.max(4, Math.min(x, window.innerWidth - rect.width - 4));
      top = Math.max(4, Math.min(y, window.innerHeight - rect.height - 4));
      positioned = true;
      focusAt(0);
    });
  });

  onMount(() => {
    function outsidePointer(event: PointerEvent) {
      if (event.target instanceof Node && !panel?.contains(event.target)) onClose();
    }
    function close() {
      onClose();
    }
    window.addEventListener('pointerdown', outsidePointer, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('pointerdown', outsidePointer, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  bind:this={panel}
  class="sidebar-context-menu"
  style:left={`${left}px`}
  style:top={`${top}px`}
  style:visibility={positioned ? 'visible' : 'hidden'}
  role="menu"
  aria-label={ariaLabel}
>
  {#each items as item (item.id)}
    {#if item.separatorBefore}<div class="context-menu-separator" role="separator"></div>{/if}
    <button
      class:danger={item.danger}
      class:keyboard-active={item.id === activeId}
      data-context-menu-id={item.id}
      disabled={item.disabled}
      role="menuitem"
      tabindex="-1"
      onmouseenter={() => {
        if (!item.disabled) activeId = item.id;
      }}
      onclick={() => onSelect(item.id)}
    >
      {item.label}
    </button>
  {/each}
</div>
