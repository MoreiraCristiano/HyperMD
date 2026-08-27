<script lang="ts">
  import FileTree from './FileTree.svelte';
  import SidebarContextMenu, { type SidebarContextMenuItem } from './SidebarContextMenu.svelte';
  import { dialogService } from '../dialogs/dialogStore';
  import {
    sidebarActions,
    sidebarState,
    workspacePickerRequest,
    workspaceRefreshRequest,
  } from './sidebarStore';
  import {
    chooseWorkspace,
    createMarkdownFile,
    createWorkspaceFolder,
    moveWorkspaceEntry,
    pathName,
    readWorkspaceDirectory,
    relativeWorkspacePath,
    removeWorkspaceEntry,
    renameWorkspaceEntry,
    type FileNode,
  } from './workspace';

  type Props = {
    activePath: string | null;
    onOpenFile: (path: string) => Promise<boolean>;
    onBeforeDelete: (path: string, isDirectory: boolean) => Promise<boolean>;
    onDeleted: (path: string, isDirectory: boolean) => void;
    onRenamed: (oldPath: string, newPath: string, isDirectory: boolean) => void;
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

  let { activePath, onOpenFile, onBeforeDelete, onDeleted, onRenamed, onError }: Props = $props();
  let entries = $state<FileNode[]>([]);
  let selectedNode = $state<FileNode | null>(null);
  let selectedDirectory = $state<string | null>(null);
  let loading = $state(false);
  let handledWorkspaceRequest = 0;
  let loadedWorkspacePath: string | null = null;
  let handledRefreshRequest = 0;
  let contextMenu = $state<ContextMenuState | null>(null);
  let draggedNode = $state<FileNode | null>(null);
  let dropTargetPath = $state<string | null>(null);
  let contextMenuId = 0;

  async function run(action: () => Promise<void>) {
    try {
      await action();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function selectWorkspace() {
    const path = await chooseWorkspace();
    if (!path) return;
    sidebarActions.setWorkspace(path, pathName(path));
  }

  async function loadRoot() {
    const root = $sidebarState.workspacePath;
    if (!root) return;
    loading = true;
    try {
      entries = await readWorkspaceDirectory(root, root);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      loading = false;
    }
  }

  async function toggleDirectory(node: FileNode) {
    node.expanded = !node.expanded;
    if (!node.expanded || node.loaded || node.loading) return;
    const root = $sidebarState.workspacePath;
    if (!root) return;
    node.loading = true;
    await run(async () => {
      node.children = await readWorkspaceDirectory(root, node.path);
      node.loaded = true;
    });
    node.loading = false;
  }

  function findDirectory(nodes: FileNode[], path: string): FileNode | null {
    for (const node of nodes) {
      if (node.isDirectory && samePath(node.path, path)) return node;
      const nested = findDirectory(node.children, path);
      if (nested) return nested;
    }
    return null;
  }

  function normalizedPath(path: string): string {
    const value = path.replace(/\\/g, '/').replace(/\/+$/, '');
    return /^[A-Za-z]:/.test(value) ? value.toLowerCase() : value;
  }

  function samePath(left: string, right: string): boolean {
    return normalizedPath(left) === normalizedPath(right);
  }

  function parentPath(path: string): string {
    return path.replace(/[\\/][^\\/]+$/, '');
  }

  function canDropInto(destination: string): boolean {
    const source = draggedNode;
    if (!source || samePath(parentPath(source.path), destination)) return false;
    if (!source.isDirectory) return true;
    const sourcePath = normalizedPath(source.path);
    const destinationPath = normalizedPath(destination);
    return destinationPath !== sourcePath && !destinationPath.startsWith(`${sourcePath}/`);
  }

  function compareNodes(left: FileNode, right: FileNode): number {
    if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  }

  function detachNode(nodes: FileNode[], path: string): FileNode | null {
    const index = nodes.findIndex((node) => samePath(node.path, path));
    if (index !== -1) return nodes.splice(index, 1)[0];
    for (const node of nodes) {
      const detached = detachNode(node.children, path);
      if (detached) return detached;
    }
    return null;
  }

  function rewriteNodePaths(node: FileNode, oldPath: string, newPath: string) {
    node.path = `${newPath}${node.path.slice(oldPath.length)}`;
    node.children.forEach((child) => rewriteNodePaths(child, oldPath, newPath));
  }

  function applyTreeMove(oldPath: string, newPath: string, destination: string) {
    const node = detachNode(entries, oldPath);
    if (!node) return;
    rewriteNodePaths(node, oldPath, newPath);
    const root = $sidebarState.workspacePath;
    if (root && samePath(destination, root)) {
      entries.push(node);
      entries.sort(compareNodes);
    } else {
      const target = findDirectory(entries, destination);
      if (target?.loaded) {
        target.children.push(node);
        target.children.sort(compareNodes);
      }
    }
    selectedNode = node;
    selectedDirectory = node.isDirectory ? node.path : destination;
  }

  async function moveNodeToDirectory(node: FileNode, destination: string) {
    const root = $sidebarState.workspacePath;
    if (!root) return;
    await run(async () => {
      const oldPath = node.path;
      const requestedDirectory = relativeWorkspacePath(root, destination) || '.';
      const newPath = await moveWorkspaceEntry(root, oldPath, requestedDirectory);
      if (samePath(newPath, oldPath)) return;
      applyTreeMove(oldPath, newPath, destination);
      onRenamed(oldPath, newPath, node.isDirectory);
    });
  }

  function beginDrag(node: FileNode, event: DragEvent) {
    draggedNode = node;
    dropTargetPath = null;
    contextMenu = null;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('application/x-hypermd-workspace-entry', node.path);
    }
  }

  function endDrag() {
    draggedNode = null;
    dropTargetPath = null;
  }

  function dragOverNode(node: FileNode, event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    const valid = node.isDirectory && canDropInto(node.path);
    dropTargetPath = valid ? node.path : null;
    if (event.dataTransfer) event.dataTransfer.dropEffect = valid ? 'move' : 'none';
  }

  function dragLeaveNode(node: FileNode, event: DragEvent) {
    event.stopPropagation();
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget instanceof Node) {
      if (event.currentTarget.contains(related)) return;
    }
    if (dropTargetPath === node.path) dropTargetPath = null;
  }

  function dropOnNode(node: FileNode, event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    const source = draggedNode;
    const valid = source && node.isDirectory && canDropInto(node.path);
    endDrag();
    if (source && valid) void moveNodeToDirectory(source, node.path);
  }

  function dragOverRoot(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    const root = $sidebarState.workspacePath;
    const valid = Boolean(root && canDropInto(root));
    dropTargetPath = valid ? root : null;
    if (event.dataTransfer) event.dataTransfer.dropEffect = valid ? 'move' : 'none';
  }

  function dragLeaveRoot(event: DragEvent) {
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget instanceof Node) {
      if (event.currentTarget.contains(related)) return;
    }
    if (dropTargetPath === $sidebarState.workspacePath) dropTargetPath = null;
  }

  function dropOnRoot(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    const source = draggedNode;
    const root = $sidebarState.workspacePath;
    const valid = source && root && canDropInto(root);
    endDrag();
    if (source && root && valid) void moveNodeToDirectory(source, root);
  }

  async function refreshDirectory(path: string) {
    const root = $sidebarState.workspacePath;
    if (!root) return;
    if (path === root) {
      await loadRoot();
      return;
    }
    const node = findDirectory(entries, path);
    if (!node) {
      await loadRoot();
      return;
    }
    node.children = await readWorkspaceDirectory(root, path);
    node.loaded = true;
    node.expanded = true;
  }

  function operationDirectory(): string | null {
    return selectedDirectory ?? $sidebarState.workspacePath;
  }

  async function createFile() {
    const root = $sidebarState.workspacePath;
    const parent = operationDirectory();
    if (!root || !parent) return;
    const name = await dialogService.prompt({
      title: 'New Markdown File',
      label: 'File name',
      value: 'new-file.md',
      confirmLabel: 'Create',
      required: true,
    });
    if (!name) return;
    await run(async () => {
      const path = await createMarkdownFile(root, parent, name);
      await refreshDirectory(parent);
      await onOpenFile(path);
    });
  }

  async function createFolder() {
    const root = $sidebarState.workspacePath;
    const parent = operationDirectory();
    if (!root || !parent) return;
    const name = await dialogService.prompt({
      title: 'New Folder',
      label: 'Folder name',
      value: 'new-folder',
      confirmLabel: 'Create',
      required: true,
    });
    if (!name) return;
    await run(async () => {
      await createWorkspaceFolder(root, parent, name);
      await refreshDirectory(parent);
    });
  }

  async function renameSelected() {
    const root = $sidebarState.workspacePath;
    const node = selectedNode;
    if (!root || !node) return;
    const name = await dialogService.prompt({
      title: 'Rename',
      label: 'New name',
      value: node.name,
      confirmLabel: 'Rename',
      required: true,
    });
    if (!name || name === node.name) return;
    await run(async () => {
      const newPath = await renameWorkspaceEntry(
        root,
        node.path,
        name,
        node.isDirectory,
        node.type,
      );
      onRenamed(node.path, newPath, node.isDirectory);
      selectedNode = null;
      selectedDirectory = root;
      await loadRoot();
    });
  }

  async function moveSelected() {
    const root = $sidebarState.workspacePath;
    const node = selectedNode;
    if (!root || !node) return;
    const destination = await dialogService.prompt({
      title: 'Move',
      message: 'Enter a destination folder relative to the workspace. Use . for the root.',
      label: 'Destination folder',
      value: '.',
      confirmLabel: 'Move',
      required: true,
    });
    if (destination === null) return;
    const relativeDestination = destination.trim().replace(/\\/g, '/');
    const destinationPath =
      !relativeDestination || relativeDestination === '.'
        ? root
        : `${root.replace(/[\\/]+$/, '')}/${relativeDestination}`;
    await moveNodeToDirectory(node, destinationPath);
  }

  async function deleteSelected() {
    const root = $sidebarState.workspacePath;
    const node = selectedNode;
    if (!root || !node) return;
    const label = node.isDirectory
      ? `the folder “${node.name}” and all its contents`
      : `“${node.name}”`;
    const confirmed = await dialogService.confirm({
      title: node.isDirectory ? 'Delete Folder' : 'Delete File',
      message: `Delete ${label}? This action cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) return;
    if (!(await onBeforeDelete(node.path, node.isDirectory))) return;
    await run(async () => {
      await removeWorkspaceEntry(root, node.path, node.isDirectory);
      onDeleted(node.path, node.isDirectory);
      selectedNode = null;
      selectedDirectory = root;
      await loadRoot();
    });
  }

  function selectDirectory(node: FileNode) {
    selectedNode = node;
    selectedDirectory = node.path;
  }

  function selectFile(node: FileNode) {
    selectedNode = node;
    selectedDirectory = node.path.replace(/[\\/][^\\/]+$/, '');
  }

  function openFile(node: FileNode) {
    void onOpenFile(node.path);
  }

  function openNodeContextMenu(node: FileNode, event: MouseEvent) {
    if (node.isDirectory) selectDirectory(node);
    else selectFile(node);
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
    selectedNode = null;
    selectedDirectory = root;
    contextMenu = {
      id: ++contextMenuId,
      x: event.clientX,
      y: event.clientY,
      node: null,
    };
  }

  function contextItems(node: FileNode | null): readonly SidebarContextMenuItem[] {
    if (!node) return rootContextItems;
    return node.isDirectory ? folderContextItems : fileContextItems;
  }

  async function executeContextAction(action: string) {
    const target = contextMenu?.node ?? null;
    contextMenu = null;
    endDrag();
    if (action === 'open' && target && !target.isDirectory) openFile(target);
    else if (action === 'new-file') await createFile();
    else if (action === 'new-folder') await createFolder();
    else if (action === 'rename') await renameSelected();
    else if (action === 'move') await moveSelected();
    else if (action === 'delete') await deleteSelected();
    else if (action === 'refresh') {
      if (target?.isDirectory) await refreshDirectory(target.path);
      else await loadRoot();
    }
  }

  function refresh() {
    void loadRoot();
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
    void refreshDirectory(request.path);
  });

  $effect(() => {
    const path = $sidebarState.workspacePath;
    if (path === loadedWorkspacePath) return;
    loadedWorkspacePath = path;
    selectedDirectory = path;
    selectedNode = null;
    contextMenu = null;
    entries = [];
    if (path) void loadRoot();
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
      <button onclick={selectWorkspace}>Open Folder</button>
    </div>
  {:else}
    <div class="explorer-heading">
      <button
        class="workspace-label"
        class:drop-target={dropTargetPath === $sidebarState.workspacePath}
        onclick={() => {
          selectedDirectory = $sidebarState.workspacePath;
          selectedNode = null;
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
      role="group"
      aria-label="Workspace files"
      class:loading
      class:drop-target-root={dropTargetPath === $sidebarState.workspacePath}
      ondragover={dragOverRoot}
      ondragleave={dragLeaveRoot}
      ondrop={dropOnRoot}
    >
      <FileTree
        nodes={entries}
        {activePath}
        selectedPath={selectedNode?.path ?? null}
        onToggle={(node) => void toggleDirectory(node)}
        onOpenFile={openFile}
        onSelectDirectory={selectDirectory}
        onSelectFile={selectFile}
        onContextMenu={openNodeContextMenu}
        draggedPath={draggedNode?.path ?? null}
        {dropTargetPath}
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
