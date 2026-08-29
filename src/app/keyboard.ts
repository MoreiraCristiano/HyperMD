import { get } from 'svelte/store';
import { dialogState } from '@/shared/ui/dialogs';
import type { AppCommandId } from './commands';

type AppKeyboardOptions = {
  isCommandPaletteOpen: () => boolean;
  isTablePickerOpen: () => boolean;
  toggleCommandPalette: () => void;
  executeCommand: (id: AppCommandId) => Promise<void>;
  activateTabPosition: (position: number) => void;
};

export function createAppKeydownHandler(options: AppKeyboardOptions) {
  return function handleKeydown(event: KeyboardEvent): void {
    const command = event.ctrlKey || event.metaKey;
    if (!command) return;
    const key = event.key.toLowerCase();

    if (get(dialogState) || options.isTablePickerOpen()) {
      if (['b', 'f', 'n', 'o', 'p', 's', 'tab', 'w'].includes(key)) event.preventDefault();
      return;
    }

    if (key === 'p' && event.shiftKey && !event.altKey) {
      event.preventDefault();
      options.toggleCommandPalette();
      return;
    }
    if (options.isCommandPaletteOpen()) return;

    if (key === 'b') {
      event.preventDefault();
      void options.executeCommand('view.toggleSidebar');
    } else if (key === 'f') {
      event.preventDefault();
      void options.executeCommand('edit.find');
    } else if (key === 'w') {
      event.preventDefault();
      void options.executeCommand('file.closeTab');
    } else if (key === 'tab') {
      event.preventDefault();
      void options.executeCommand(event.shiftKey ? 'tabs.previous' : 'tabs.next');
    } else if (/^[1-9]$/.test(key) && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      options.activateTabPosition(Number(key) - 1);
    } else if (key === 's') {
      event.preventDefault();
      void options.executeCommand(event.shiftKey ? 'file.saveAs' : 'file.save');
    } else if (key === 'o') {
      event.preventDefault();
      void options.executeCommand('file.open');
    } else if (key === 'n') {
      event.preventDefault();
      void options.executeCommand('file.new');
    }
  };
}
