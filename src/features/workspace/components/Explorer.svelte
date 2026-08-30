<script lang="ts">
  import FileTree from './FileTree.svelte';
  import SidebarContextMenu, { type SidebarContextMenuItem } from './SidebarContextMenu.svelte';
  import { dialogService } from '@/shared/ui/dialogs';
  import { sidebarState, workspacePickerRequest, workspaceRefreshRequest } from '../workspaceStore';
  import {
    createExplorerOperations,
    type FileNode,
    type WorkspaceFileType,
  } from '../explorerOperations';
  import { ExplorerCommands } from '../explorerCommands';
  import { ExplorerDragController } from '../explorerDrag.svelte';
  import { ExplorerMoveController } from '../explorerMove.svelte';
  import { ExplorerSelection } from '../explorerSelection.svelte';
  import { ExplorerTree } from '../explorerTree.svelte';

  type Props = {
    activePath: string | null;
    onOpenFile: (path: string) => Promise<boolean>;
    onChangeWorkspace: (path: string) => Promise<boolean>;
    onBeforeDelete: (path: string, isDirectory: boolean) => Promise<boolean>;
    onDeleted: (path: string, isDirectory: boolean) => void;
    onRenameEntry: (
      oldPath: string,
      requestedName: string,
      isDirectory: boolean,
      fileType: WorkspaceFileType | null,
    ) => Promise<string>;
    onRenamed: (oldPath: string, newPath: string, isDirectory: boolean) => Promise<void>;
    onError: (message: string) => void;
  };

  type ContextMenuState = {
    id: number;
    x: number;
    y: number;
    node: FileNode | null;
  };

  const fileContextItems: readonly SidebarContextMenuItem[] = [
    { id: 'open', label: 'Open' },
    { id: 'rename', label: 'Rename', separatorBefore: true },
    { id: 'move', label: 'Move' },
    { id: 'delete', label: 'Delete', danger: true },
  ];
  const folderContextItems: readonly SidebarContextMenuItem[] = [
    { id: 'new-file', label: 'New File' },
    { id: 'new-folder', label: 'New Folder' },
    { id: 'rename', label: 'Rename', separatorBefore: true },
    { id: 'move', label: 'Move' },
    { id: 'delete', label: 'Delete', danger: true },
    { id: 'refresh', label: 'Refresh', separatorBefore: true },
  ];
  const rootContextItems: readonly SidebarContextMenuItem[] = [
    { id: 'new-file', label: 'New File' },
    { id: 'new-folder', label: 'New Folder' },
    { id: 'refresh', label: 'Refresh', separatorBefore: true },
  ];
  const multiContextItems: readonly SidebarContextMenuItem[] = [
    { id: 'move', label: 'Move' },
    { id: 'delete', label: 'Delete', danger: true },
  ];

  let {
    activePath,
    onOpenFile,
    onChangeWorkspace,
    onBeforeDelete,
    onDeleted,
    onRenameEntry,
    onRenamed,
    onError,
  }: Props = $props();
  const operations = createExplorerOperations({
    renameEntry: (...args) => onRenameEntry(...args),
    beforeDelete: (...args) => onBeforeDelete(...args),
    deleted: (...args) => onDeleted(...args),
    changeWorkspace: (...args) => onChangeWorkspace(...args),
  });
  const getRoot = () => $sidebarState.workspacePath;
  const selection = new ExplorerSelection(getRoot);
  const tree = new ExplorerTree({
    operations,
    getRoot,
    selection,
    onError: (message) => onError(message),
  });
  const move = new ExplorerMoveController({
    operations,
    getRoot,
    tree,
    selection,
    prompt: (options) => dialogService.prompt(options),
    onRenamed: (...args) => onRenamed(...args),
    onError: (message) => onError(message),
  });
  const commands = new ExplorerCommands({
    operations,
    getRoot,
    tree,
    selection,
    prompt: (options) => dialogService.prompt(options),
    confirm: (options) => dialogService.confirm(options),
    onOpenFile: (path) => onOpenFile(path),
    onError: (message) => onError(message),
  });
  const drag = new ExplorerDragController({
    getRoot,
    getEntries: () => tree.entries,
    selection,
    moveNodes: (nodes, destination) => move.moveNodesToDirectory(nodes, destination),
  });
  let handledWorkspaceRequest = 0;
  let loadedWorkspacePath: string | null = null;
  let handledRefreshRequest = 0;
  let contextMenu = $state<ContextMenuState | null>(null);
  let contextMenuId = 0;

  async function selectWorkspace() {
    await commands.selectWorkspace();
  }

  async function createFile() {
    await commands.createFile();
  }

  async function createFolder() {
    await commands.createFolder();
  }

  function refresh() {
    void tree.loadRoot();
  }

  function clearSelection() {
    selection.clear();
  }

  function beginDrag(node: FileNode, event: DragEvent) {
    drag.begin(node, event);
    contextMenu = null;
  }

  function endDrag() {
    drag.end();
  }

  function dragOverNode(node: FileNode, event: DragEvent) {
    drag.overNode(node, event);
  }

  function dragLeaveNode(node: FileNode, event: DragEvent) {
    drag.leaveNode(node, event);
  }

  function dropOnNode(node: FileNode, event: DragEvent) {
    drag.dropOnNode(node, event);
  }

  function dragOverRoot(event: DragEvent) {
    drag.overRoot(event);
  }

  function dragLeaveRoot(event: DragEvent) {
    drag.leaveRoot(event);
  }

  function dropOnRoot(event: DragEvent) {
    drag.dropOnRoot(event);
  }

  function activateNode(node: FileNode, event: MouseEvent) {
    const selectionOnly = selection.updateForClick(node, tree.entries, event);
    if (selectionOnly) return;
    if (node.isDirectory) void tree.toggleDirectory(node);
    else openFile(node);
  }

  function openFile(node: FileNode) {
    void onOpenFile(node.path);
  }

  function openNodeContextMenu(node: FileNode, event: MouseEvent) {
    if (!selection.pathSet.has(node.path)) selection.selectSingle(node);
    contextMenu = {
      id: ++contextMenuId,
      x: event.clientX,
      y: event.clientY,
      node,
    };
  }

  function openRootContextMenu(event: MouseEvent) {
    const target = event.target;
    if (target instanceof Element && target.closest('.tree-item, .sidebar-context-menu')) {
      return;
    }
    const root = $sidebarState.workspacePath;
    if (!root) return;
    event.preventDefault();
    target instanceof Element && target.closest<HTMLElement>('button')?.focus();
    clearSelection();
    contextMenu = {
      id: ++contextMenuId,
      x: event.clientX,
      y: event.clientY,
      node: null,
    };
  }

  function contextItems(node: FileNode | null): readonly SidebarContextMenuItem[] {
    if (!node) return rootContextItems;
    if (selection.paths.length > 1) return multiContextItems;
    return node.isDirectory ? folderContextItems : fileContextItems;
  }

  async function executeContextAction(action: string) {
    const target = contextMenu?.node ?? null;
    contextMenu = null;
    endDrag();
    if (action === 'open' && target && !target.isDirectory) openFile(target);
    else if (action === 'new-file') await commands.createFile();
    else if (action === 'new-folder') await commands.createFolder();
    else if (action === 'rename') await commands.renameSelected();
    else if (action === 'move') await move.moveSelected();
    else if (action === 'delete') await commands.deleteSelected();
    else if (action === 'refresh') {
      if (target?.isDirectory) await tree.refreshDirectory(target.path);
      else await tree.loadRoot();
    }
  }

  function handleExplorerKeydown(event: KeyboardEvent) {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('input, textarea, select, [contenteditable="true"], .sidebar-context-menu')
    ) {
      return;
    }
    const command = event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      event.stopPropagation();
      selection.selectAll(tree.entries);
    } else if (event.key === 'Delete' && selection.paths.length) {
      event.preventDefault();
      event.stopPropagation();
      void commands.deleteSelected();
    }
  }

  function clearSelectionFromBlankArea(event: MouseEvent) {
    const target = event.target;
    if (target instanceof Element && target.closest('.tree-item')) return;
    clearSelection();
    if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
  }

  $effect(() => {
    const request = $workspacePickerRequest;
    if (request > handledWorkspaceRequest) {
      handledWorkspaceRequest = request;
      void selectWorkspace();
    }
  });

  $effect(() => {
    const request = $workspaceRefreshRequest;
    if (!request || request.id <= handledRefreshRequest) return;
    handledRefreshRequest = request.id;
    void tree.refreshDirectory(request.path);
  });

  $effect(() => {
    if ($sidebarState.visible) return;
    contextMenu = null;
    endDrag();
  });

  $effect(() => {
    const path = $sidebarState.workspacePath;
    if (path === loadedWorkspacePath) return;
    loadedWorkspacePath = path;
    selection.reset(path);
    contextMenu = null;
    endDrag();
    tree.reset();
    if (path) void tree.loadRoot();
  });
</script>

<div
  class="explorer-content"
  role="region"
  aria-label="Explorer"
  oncontextmenu={openRootContextMenu}
>
  <header class="sidebar-title">EXPLORER</header>

  {#if !$sidebarState.workspacePath}
    <div class="empty-workspace">
      <p>No folder open.</p>
    </div>
    <button class="change-workspace" onclick={selectWorkspace}>Open Folder</button>
  {:else}
    <div class="explorer-heading">
      <button
        class="workspace-label"
        class:drop-target={drag.dropTargetPath === $sidebarState.workspacePath}
        onclick={() => {
          clearSelection();
        }}
        ondragover={dragOverRoot}
        ondragleave={dragLeaveRoot}
        ondrop={dropOnRoot}
        title={$sidebarState.workspacePath}
      >
        {$sidebarState.workspaceName}
      </button>
      <div class="explorer-actions">
        <button onclick={createFile} title="New Markdown file" aria-label="New file">
          <svg viewBox="0 0 16 16"><path d="M3 1.5h6l4 4v9H3zM9 1.5v4h4M8 8v4M6 10h4" /></svg>
        </button>
        <button onclick={createFolder} title="New folder" aria-label="New folder">
          <svg viewBox="0 0 16 16"><path d="M1.5 3.5h5l1.5 2h6.5v7h-13zM8 7v4M6 9h4" /></svg>
        </button>
        <button onclick={refresh} title="Refresh" aria-label="Refresh">
          <svg viewBox="0 0 16 16"><path d="M13 5V2l-1.3 1.3A5.5 5.5 0 1 0 13 9M13 2H9" /></svg>
        </button>
      </div>
    </div>
    <div
      class="explorer-tree"
      role="tree"
      aria-label="Workspace files"
      aria-multiselectable="true"
      tabindex="0"
      class:loading={tree.loading}
      class:drop-target-root={drag.dropTargetPath === $sidebarState.workspacePath}
      ondragover={dragOverRoot}
      ondragleave={dragLeaveRoot}
      ondrop={dropOnRoot}
      onclick={clearSelectionFromBlankArea}
      onkeydown={handleExplorerKeydown}
    >
      <FileTree
        nodes={tree.entries}
        {activePath}
        selectedPaths={selection.pathSet}
        draggedPaths={drag.pathSet}
        onActivate={activateNode}
        onContextMenu={openNodeContextMenu}
        dropTargetPath={drag.dropTargetPath}
        onDragStart={beginDrag}
        onDragEnd={endDrag}
        onDragOver={dragOverNode}
        onDragLeave={dragLeaveNode}
        onDrop={dropOnNode}
      />
    </div>
    <button class="change-workspace" onclick={selectWorkspace}>Open Another Folder…</button>
  {/if}

  {#if contextMenu}
    {#key contextMenu.id}
      <SidebarContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        items={contextItems(contextMenu.node)}
        onSelect={(action) => void executeContextAction(action)}
        onClose={() => (contextMenu = null)}
      />
    {/key}
  {/if}
</div>
