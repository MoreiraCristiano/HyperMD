<script lang="ts">
  import { documentManager } from '../editor/documentManager';
  import type { EditorTab } from './tabStore';

  type Props = {
    tab: EditorTab;
    active: boolean;
    onError: (message: string) => void;
  };

  let { tab, active, onError }: Props = $props();
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
  onclick={() => documentManager.activate(tab.id)}
  onkeydown={(event) => {
    if (event.key === 'Enter' || event.key === ' ') documentManager.activate(tab.id);
  }}
  ondblclick={() => documentManager.activate(tab.id)}
  onauxclick={(event) => {
    if (event.button === 1) close(event);
  }}
  title={`${tab.path ?? tab.name}${tab.missing ? ' — arquivo ausente' : ''}`}
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
  <span class="tab-name">{tab.name}</span>
  {#if tab.missing}<span class="tab-missing" title="Arquivo ausente">!</span>{/if}
  {#if tab.dirty}<span class="tab-dirty" title="Alterações não salvas">●</span>{/if}
  <button class="tab-close" onclick={close} title="Fechar" aria-label={`Fechar ${tab.name}`}>
    <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 3 6 6m0-6L3 9" /></svg>
  </button>
</div>
