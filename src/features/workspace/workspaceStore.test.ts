import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('sidebar store', () => {
  beforeEach(() => vi.resetModules());

  it('loads preferences, clamps width, persists, and dispatches actions', async () => {
    localStorage.setItem('hypermd.sidebar.visible', 'false');
    localStorage.setItem('hypermd.sidebar.width', '999');
    const {
      MAX_WIDTH,
      MIN_WIDTH,
      sidebarActions,
      sidebarState,
      workspacePickerRequest,
      workspaceRefreshRequest,
    } = await import('./workspaceStore');
    expect(get(sidebarState)).toMatchObject({ visible: false, width: MAX_WIDTH });
    sidebarActions.resize(1);
    expect(get(sidebarState).width).toBe(MIN_WIDTH);
    sidebarActions.toggle();
    expect(get(sidebarState).visible).toBe(true);
    sidebarActions.selectView('explorer');
    expect(get(sidebarState).visible).toBe(false);
    sidebarActions.show('explorer');
    sidebarActions.setWorkspace('/work', 'Work');
    expect(get(sidebarState)).toMatchObject({ workspacePath: '/work', workspaceName: 'Work' });
    sidebarActions.requestWorkspace();
    expect(get(workspacePickerRequest)).toBe(1);
    sidebarActions.refreshWorkspace('/work/docs');
    expect(get(workspaceRefreshRequest)).toEqual({ id: 1, path: '/work/docs' });
    expect(localStorage.getItem('hypermd.sidebar.width')).toBe(String(MIN_WIDTH));
  });

  it('falls back when stored preferences are malformed', async () => {
    localStorage.setItem('hypermd.sidebar.width', '{bad');
    const { sidebarState } = await import('./workspaceStore');
    expect(get(sidebarState).width).toBe(240);
  });

  it('uses defaults when preference keys are absent and rounds widths', async () => {
    const { sidebarActions, sidebarState } = await import('./workspaceStore');
    expect(get(sidebarState)).toMatchObject({ visible: true, width: 240 });
    sidebarActions.resize(222.6);
    expect(get(sidebarState).width).toBe(223);
  });

  it('works in environments without localStorage', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });
    try {
      const { sidebarActions, sidebarState } = await import('./workspaceStore');
      expect(get(sidebarState)).toMatchObject({ visible: true, width: 240 });
      sidebarActions.toggle();
      expect(get(sidebarState).visible).toBe(false);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    }
  });
});
