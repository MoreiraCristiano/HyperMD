import { writable } from 'svelte/store';

export type SidebarView = 'explorer' | 'search';

export type SidebarState = {
  visible: boolean;
  width: number;
  activeView: SidebarView;
  workspacePath: string | null;
  workspaceName: string | null;
};

const MIN_WIDTH = 180;
const MAX_WIDTH = 500;
const DEFAULT_WIDTH = 240;

function readPreference<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : (JSON.parse(value) as T);
  } catch {
    return fallback;
  }
}

function clampWidth(width: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));
}

export const sidebarState = writable<SidebarState>({
  visible: readPreference('hypermd.sidebar.visible', true),
  width: clampWidth(readPreference('hypermd.sidebar.width', DEFAULT_WIDTH)),
  activeView: 'explorer',
  workspacePath: null,
  workspaceName: null,
});

export const workspacePickerRequest = writable(0);
export const workspaceRefreshRequest = writable<{ id: number; path: string } | null>(null);
let refreshId = 0;

if (typeof localStorage !== 'undefined') {
  sidebarState.subscribe((state) => {
    localStorage.setItem('hypermd.sidebar.visible', JSON.stringify(state.visible));
    localStorage.setItem('hypermd.sidebar.width', JSON.stringify(state.width));
  });
}

export const sidebarActions = {
  selectView(activeView: SidebarView) {
    sidebarState.update((state) => ({
      ...state,
      activeView,
      visible: state.activeView === activeView ? !state.visible : true,
    }));
  },
  toggle() {
    sidebarState.update((state) => ({ ...state, visible: !state.visible }));
  },
  show(activeView: SidebarView) {
    sidebarState.update((state) => ({ ...state, activeView, visible: true }));
  },
  requestWorkspace() {
    this.show('explorer');
    workspacePickerRequest.update((request) => request + 1);
  },
  resize(width: number) {
    sidebarState.update((state) => ({ ...state, width: clampWidth(width) }));
  },
  setWorkspace(workspacePath: string, workspaceName: string) {
    sidebarState.update((state) => ({ ...state, workspacePath, workspaceName }));
  },
  refreshWorkspace(path: string) {
    workspaceRefreshRequest.set({ id: ++refreshId, path });
  },
};

export { MAX_WIDTH, MIN_WIDTH };
