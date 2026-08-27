<script lang="ts">
  import TabItem from './TabItem.svelte';
  import { tabsState } from './tabStore';

  type Props = { onError: (message: string) => void };
  let { onError }: Props = $props();
  let scroller: HTMLDivElement;

  function horizontalWheel(event: WheelEvent) {
    if (!scroller || (!event.shiftKey && Math.abs(event.deltaX) >= Math.abs(event.deltaY))) return;
    event.preventDefault();
    scroller.scrollLeft += event.deltaY;
  }
</script>

<div
  class="tab-bar"
  bind:this={scroller}
  data-tauri-drag-region
  onwheel={horizontalWheel}
  role="tablist"
  aria-label="Open files"
>
  {#each $tabsState.tabs as tab (tab.id)}
    <TabItem {tab} active={tab.id === $tabsState.activeId} {onError} />
  {/each}
</div>
