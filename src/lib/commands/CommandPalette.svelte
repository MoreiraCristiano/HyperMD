<script lang="ts">
  import { tick } from 'svelte';
  import { filterCommands, type AppCommand, type AppCommandId } from './commands';

  type Props = {
    open: boolean;
    isEnabled: (id: AppCommandId) => boolean;
    onExecute: (id: AppCommandId) => unknown | Promise<unknown>;
    onClose: () => void;
  };

  let { open, isEnabled, onExecute, onClose }: Props = $props();
  let input = $state<HTMLInputElement>();
  let query = $state('');
  let activeIndex = $state(0);
  let previousFocus: HTMLElement | null = null;
  const commands = $derived(filterCommands(query));

  $effect(() => {
    if (!open) return;
    query = '';
    activeIndex = firstEnabled(filterCommands(''));
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    void tick().then(() => input?.focus());
  });

  $effect(() => {
    query;
    activeIndex = firstEnabled(commands);
  });

  function firstEnabled(items: readonly AppCommand[]): number {
    const index = items.findIndex((command) => isEnabled(command.id));
    return index === -1 ? 0 : index;
  }

  function move(direction: number) {
    if (commands.length === 0) return;
    let next = activeIndex;
    for (let attempts = 0; attempts < commands.length; attempts += 1) {
      next = (next + direction + commands.length) % commands.length;
      if (isEnabled(commands[next].id)) {
        activeIndex = next;
        queueMicrotask(() =>
          document
            .querySelector<HTMLElement>('.command-palette-item.active')
            ?.scrollIntoView({ block: 'nearest' }),
        );
        return;
      }
    }
  }

  function close() {
    onClose();
    queueMicrotask(() => previousFocus?.focus());
  }

  async function execute(command: AppCommand) {
    if (!isEnabled(command.id)) return;
    onClose();
    try {
      await onExecute(command.id);
    } finally {
      previousFocus = null;
    }
  }

  function keydown(event: KeyboardEvent) {
    const command = event.ctrlKey || event.metaKey;
    if (command && ['b', 'f', 'n', 'o', 's', 'tab', 'w'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const command = commands[activeIndex];
      if (command) void execute(command);
    }
  }
</script>

{#if open}
  <div
    class="command-palette-backdrop"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) close();
    }}
  >
    <div
      class="command-palette"
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      tabindex="-1"
    >
      <input
        bind:this={input}
        bind:value={query}
        class="command-palette-input"
        type="search"
        placeholder="Type a command…"
        autocomplete="off"
        spellcheck="false"
        aria-label="Search commands"
        onkeydown={keydown}
      />
      <div class="command-palette-results" role="listbox" aria-label="Commands">
        {#each commands as command, index (command.id)}
          <button
            class="command-palette-item"
            class:active={index === activeIndex}
            disabled={!isEnabled(command.id)}
            role="option"
            aria-selected={index === activeIndex}
            onmouseenter={() => {
              if (isEnabled(command.id)) activeIndex = index;
            }}
            onclick={() => execute(command)}
          >
            <span class="command-palette-copy">
              <span class="command-palette-label">{command.label}</span>
              <span class="command-palette-description"
                >{command.category} · {command.description}</span
              >
            </span>
            {#if command.shortcuts?.[0]}<kbd>{command.shortcuts[0]}</kbd>{/if}
          </button>
        {:else}
          <div class="command-palette-empty">No matching commands</div>
        {/each}
      </div>
    </div>
  </div>
{/if}
