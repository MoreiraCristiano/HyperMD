<script lang="ts">
  export type MenuItem = {
    label?: string;
    shortcut?: string;
    separator?: boolean;
    disabled?: boolean;
    action?: () => unknown | Promise<unknown>;
  };

  type Props = {
    items: MenuItem[];
    onClose: () => void;
    onError: (message: string) => void;
  };

  let { items, onClose, onError }: Props = $props();

  async function run(item: MenuItem) {
    if (!item.action || item.disabled) return;
    onClose();
    try {
      await item.action();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function navigate(event: KeyboardEvent) {
    const menu = event.currentTarget as HTMLElement;
    const items = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(index + 1 + items.length) % items.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items.at(-1)?.focus();
    }
  }
</script>

<div
  class="app-menu"
  role="menu"
  tabindex="-1"
  onkeydown={navigate}
  onclick={(event) => event.stopPropagation()}
>
  {#each items as item}
    {#if item.separator}
      <div class="menu-separator" role="separator"></div>
    {:else}
      <button role="menuitem" disabled={item.disabled} onclick={() => run(item)}>
        <span>{item.label}</span>
        {#if item.shortcut}<kbd>{item.shortcut}</kbd>{/if}
      </button>
    {/if}
  {/each}
</div>
