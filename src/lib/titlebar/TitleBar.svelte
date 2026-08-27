<script lang="ts">
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import TabBar from '../tabs/TabBar.svelte';
  import WindowControls from './WindowControls.svelte';

  type Props = {
    onExit: () => void | Promise<void>;
    onError: (message: string) => void;
  };

  let { onExit, onError }: Props = $props();

  async function toggleMaximize() {
    const appWindow = getCurrentWindow();
    try {
      if (await appWindow.isMaximized()) await appWindow.unmaximize();
      else await appWindow.maximize();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function doubleClick(event: MouseEvent) {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('.tab-item, .tab-close, .window-controls button')
    ) {
      return;
    }
    void toggleMaximize();
  }
</script>

<header class="title-bar" role="presentation" ondblclick={doubleClick}>
  <div class="title-tabs">
    <TabBar {onError} />
    <div class="title-tabs-drag" data-tauri-drag-region role="presentation"></div>
  </div>
  <WindowControls {onError} onClose={onExit} />
</header>
