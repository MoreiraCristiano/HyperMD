<script lang="ts">
  import { documentManager } from '../editor/documentManager';
  import { activeTab } from '../tabs/tabStore';
  import { sidebarActions, sidebarState } from './sidebarStore';

  type Props = {
    commandPaletteOpen: boolean;
    onOpenCommandPalette: () => void;
  };

  let { commandPaletteOpen, onOpenCommandPalette }: Props = $props();
</script>

<aside class="activity-bar" aria-label="Activity Bar">
  <div class="activity-main">
    <button
      class:active={$sidebarState.visible && $sidebarState.activeView === 'explorer'}
      onclick={() => sidebarActions.selectView('explorer')}
      title="Explorer"
      aria-label="Explorer"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 4.5h6l2 2H20v13H4zM4 9h16" />
      </svg>
    </button>
    <button
      class:active={commandPaletteOpen}
      onclick={onOpenCommandPalette}
      title="Command Palette"
      aria-label="Command Palette"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m5 7 5 5-5 5M12 17h7" />
      </svg>
    </button>
  </div>
  <button
    class:active={$activeTab?.type === 'settings'}
    onclick={() => documentManager.openSettings()}
    title="Settings"
    aria-label="Settings"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path
        d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1A8 8 0 0 0 15 6l-.3-2.5h-4L10.4 6a8 8 0 0 0-1.5.9l-2.4-1-2 3.5 2 1.5a7 7 0 0 0 0 2.1l-2 1.5 2 3.5 2.4-1a8 8 0 0 0 1.5.9l.3 2.5h4l.3-2.5a8 8 0 0 0 1.5-.9l2.4 1 2-3.5-2-1.5a7 7 0 0 0 .1-1z"
      />
    </svg>
  </button>
</aside>
