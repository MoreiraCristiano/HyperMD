<script lang="ts">
  import { tick } from 'svelte';
  import { dialogState, resolveDialog, type DialogAction } from './dialogStore';

  let panel = $state<HTMLDivElement>();
  let input = $state<HTMLInputElement>();
  let inputValue = $state('');
  let activeId: number | null = null;
  let previousFocus: HTMLElement | null = null;

  $effect(() => {
    const request = $dialogState;
    if (!request) {
      const focusTarget = previousFocus;
      if (activeId !== null) queueMicrotask(() => focusTarget?.focus());
      activeId = null;
      previousFocus = null;
      return;
    }

    if (activeId === null) {
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    if (activeId === request.id) return;
    activeId = request.id;
    inputValue = request.input?.value ?? '';
    void tick().then(() => {
      if (input) {
        input.focus();
        input.select();
      } else {
        panel
          ?.querySelector<HTMLButtonElement>('.dialog-action-primary, .dialog-action-danger')
          ?.focus();
      }
    });
  });

  function cancel(): void {
    resolveDialog(null);
  }

  function choose(action: DialogAction): void {
    const request = $dialogState;
    if (!request) return;
    if (action.id === 'cancel') {
      cancel();
      return;
    }
    if (request.kind === 'prompt' && action.id === 'confirm') {
      if (request.input?.required && !inputValue.trim()) return;
      resolveDialog(inputValue);
      return;
    }
    resolveDialog(action.id);
  }

  function handleKeydown(event: KeyboardEvent): void {
    const request = $dialogState;
    if (!request) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key === 'Enter' && event.target === input) {
      event.preventDefault();
      const action = request.actions.find((candidate) => candidate.id === 'confirm');
      if (action) choose(action);
      return;
    }
    if (event.key !== 'Tab' || !panel) return;
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)'),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if $dialogState}
  <div
    class="dialog-backdrop"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) cancel();
    }}
  >
    <div
      bind:this={panel}
      class="app-dialog"
      class:dialog-warning={$dialogState.tone === 'warning'}
      class:dialog-danger={$dialogState.tone === 'danger'}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`dialog-title-${$dialogState.id}`}
      aria-describedby={$dialogState.message ? `dialog-message-${$dialogState.id}` : undefined}
    >
      <header class="dialog-header">
        <h2 id={`dialog-title-${$dialogState.id}`}>{$dialogState.title}</h2>
      </header>
      <div class="dialog-body">
        {#if $dialogState.message}
          <p id={`dialog-message-${$dialogState.id}`}>{$dialogState.message}</p>
        {/if}
        {#if $dialogState.input}
          <label class="dialog-field">
            <span>{$dialogState.input.label}</span>
            <input
              bind:this={input}
              bind:value={inputValue}
              placeholder={$dialogState.input.placeholder}
              autocomplete="off"
              spellcheck="false"
            />
          </label>
        {/if}
      </div>
      <footer class="dialog-actions">
        {#each $dialogState.actions as action (action.id)}
          <button
            class:dialog-action-primary={action.variant === 'primary'}
            class:dialog-action-danger={action.variant === 'danger'}
            disabled={$dialogState.kind === 'prompt' &&
              action.id === 'confirm' &&
              $dialogState.input?.required &&
              !inputValue.trim()}
            onclick={() => choose(action)}
          >
            {action.label}
          </button>
        {/each}
      </footer>
    </div>
  </div>
{/if}
