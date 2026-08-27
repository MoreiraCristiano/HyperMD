<script lang="ts">
  import { onMount } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';

  type Props = {
    onClose: () => void | Promise<void>;
    onError: (message: string) => void;
  };

  let { onClose, onError }: Props = $props();
  let maximized = $state(false);
  let syncTimer: ReturnType<typeof setTimeout> | undefined;
  const appWindow = getCurrentWindow();

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function syncMaximized() {
    maximized = await appWindow.isMaximized();
  }

  async function toggleMaximize() {
    if (await appWindow.isMaximized()) await appWindow.unmaximize();
    else await appWindow.maximize();
    await syncMaximized();
  }

  onMount(() => {
    void run(syncMaximized);
    let mounted = true;
    let unlistenResize: (() => void) | undefined;
    void appWindow
      .onResized(() => {
        clearTimeout(syncTimer);
        syncTimer = setTimeout(() => void run(syncMaximized), 80);
      })
      .then((unlisten) => {
        if (mounted) unlistenResize = unlisten;
        else unlisten();
      })
      .catch((cause) => onError(cause instanceof Error ? cause.message : String(cause)));
    return () => {
      mounted = false;
      clearTimeout(syncTimer);
      unlistenResize?.();
    };
  });
</script>

<div class="window-controls" aria-label="Window controls">
  <button onclick={() => run(() => appWindow.minimize())} title="Minimize" aria-label="Minimize">
    <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 8.5h8" /></svg>
  </button>
  <button
    onclick={() => run(toggleMaximize)}
    title={maximized ? 'Restore' : 'Maximize'}
    aria-label={maximized ? 'Restore' : 'Maximize'}
  >
    {#if maximized}
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path d="M3.5 4.5h5v5h-5zM5 4.5V3h4v4H8.5" />
      </svg>
    {:else}
      <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="2.5" width="7" height="7" /></svg
      >
    {/if}
  </button>
  <button
    class="window-close"
    onclick={() => run(async () => onClose())}
    title="Close"
    aria-label="Close"
  >
    <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m2.5 2.5 7 7m0-7-7 7" /></svg>
  </button>
</div>
