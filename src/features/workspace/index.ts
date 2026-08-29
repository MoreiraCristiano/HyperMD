export { default as ActivityBar } from './components/ActivityBar.svelte';
export { default as Sidebar } from './components/Sidebar.svelte';
export { default as SidebarContextMenu } from './components/SidebarContextMenu.svelte';
export type { ContextMenuItem } from './components/SidebarContextMenu.svelte';
export { WORKSPACE_ENTRY_DRAG_TYPE, WORKSPACE_IMAGE_DRAG_TYPE } from './components/dragTypes';
export {
  MAX_WIDTH,
  MIN_WIDTH,
  sidebarActions,
  sidebarState,
  workspacePickerRequest,
  workspaceRefreshRequest,
} from './workspaceStore';
export {
  chooseWorkspace,
  isInsideWorkspace,
  listWorkspaceMarkdownFiles,
  pathName,
} from './workspaceService';
