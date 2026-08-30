import { writable } from 'svelte/store';

const state = writable<string | null>(null);

export const documentNotice = { subscribe: state.subscribe };

export const documentNoticeActions = {
  show(message: string): void {
    state.set(message);
  },
  clear(): void {
    state.set(null);
  },
};
