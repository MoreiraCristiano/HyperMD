<script lang="ts">
  import FileTree from './FileTree.svelte';
  import SidebarContextMenu, { type SidebarContextMenuItem } from './SidebarContextMenu.svelte';
  import { WORKSPACE_ENTRY_DRAG_TYPE, WORKSPACE_IMAGE_DRAG_TYPE } from './dragTypes';
  import { dialogService } from '../dialogs/dialogStore';
  import { sidebarState, workspacePickerRequest, workspaceRefreshRequest } from './sidebarStore';
  import {
    chooseWorkspace,
    createMarkdownFile,
    createWorkspaceFolder,
    moveWorkspaceEntries,
    pathName,
    readWorkspaceDirectory,
    relativeWorkspacePath,
    removeWorkspaceEntry,
    renameWorkspaceEntry,
    type FileNode,
    type WorkspaceMove,
  } from './workspace';

  type Props = {
    activePath: string | null;
    onOpenFile: (path: string) => Promise<boolean>;
    onChangeWorkspace: (path: string) => Promise<boolean>;
    onBeforeDelete: (path: string, isDirectory: boolean) => Promise<boolean>;
    onDeleted: (path: string, isDirectory: boolean) => void;
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
    onRenamed,
    onError,
  }: Props = $props();
  let entries = $state<FileNode[]>([]);
  let selectedPaths = $state<string[]>([]);
  let selectionAnchorPath = $state<string | null>(null);
  let selectedDirectory = $state<string | null>(null);
  let loading = $state(false);
  let handledWorkspaceRequest = 0;
  let loadedWorkspacePath: string | null = null;
  let handledRefreshRequest = 0;
  let contextMenu = $state<ContextMenuState | null>(null);
  let draggedNodes = $state<FileNode[]>([]);
  let draggedPaths = $state<string[]>([]);
  let dropTargetPath = $state<string | null>(null);
  let contextMenuId = 0;
  let selectedPathSet = $derived(new Set(selectedPaths));
  let draggedPathSet = $derived(new Set(draggedPaths));

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
    await onChangeWorkspace(path);
  }

  async function loadRoot() {
    const root = $sidebarState.workspacePath;
    if (!root) return;
    loading = true;
    try {
      entries = await readWorkspaceDirectory(root, root);
      clearSelection();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      loading = false;
    }
  }

  async function toggleDirectory(node: FileNode) {
    node.expanded = !node.expanded;
    if (!node.expanded) {
      selectedPaths = selectedPaths.filter((path) => !isDescendantPath(node.path, path));
      if (selectionAnchorPath && isDescendantPath(node.path, selectionAnchorPath)) {
        selectionAnchorPath = node.path;
      }
      return;
    }
    if (node.loaded || node.loading) return;
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

  function isDescendantPath(parent: string, path: string): boolean {
    const normalizedParent = normalizedPath(parent);
    const normalizedChild = normalizedPath(path);
    return (
      normalizedChild !== normalizedParent && normalizedChild.startsWith(`${normalizedParent}/`)
    );
  }

  function parentPath(path: string): string {
    return path.replace(/[\\/][^\\/]+$/, '');
  }

  function findNode(nodes: FileNode[], path: string): FileNode | null {
    for (const node of nodes) {
      if (samePath(node.path, path)) return node;
      const nested = findNode(node.children, path);
      if (nested) return nested;
    }
    return null;
  }

  function visibleNodes(nodes: FileNode[] = entries): FileNode[] {
    const visible: FileNode[] = [];
    for (const node of nodes) {
      visible.push(node);
      if (node.isDirectory && node.expanded) visible.push(...visibleNodes(node.children));
    }
    return visible;
  }

  function nodesForPaths(paths: readonly string[]): FileNode[] {
    const requested = new Set(paths);
    const matches: FileNode[] = [];
    function visit(nodes: FileNode[]) {
      for (const node of nodes) {
        if (requested.has(node.path)) matches.push(node);
        if (node.children.length) visit(node.children);
      }
    }
    visit(entries);
    return matches;
  }

  function selectedOperationNodes(): FileNode[] {
    const selected = new Set(selectedPaths);
    const matches: FileNode[] = [];
    function visit(nodes: FileNode[], selectedAncestor: boolean) {
      for (const node of nodes) {
        const isSelected = selected.has(node.path);
        if (isSelected && !selectedAncestor) matches.push(node);
        if (node.children.length) {
          visit(node.children, selectedAncestor || (isSelected && node.isDirectory));
        }
      }
    }
    visit(entries, false);
    return matches;
  }

  function setSingleSelection(node: FileNode) {
    selectedPaths = [node.path];
    selectionAnchorPath = node.path;
    selectedDirectory = node.isDirectory ? node.path : parentPath(node.path);
  }

  function clearSelection() {
    selectedPaths = [];
    selectionAnchorPath = null;
    selectedDirectory = $sidebarState.workspacePath;
  }

  function updateSelectionForClick(node: FileNode, event: MouseEvent): boolean {
    const additive = event.ctrlKey || event.metaKey;
    if (event.shiftKey) {
      const visible = visibleNodes();
      const anchorIndex = visible.findIndex((candidate) => candidate.path === selectionAnchorPath);
      const targetIndex = visible.findIndex((candidate) => samePath(candidate.path, node.path));
      if (anchorIndex === -1 || targetIndex === -1) {
        setSingleSelection(node);
      } else {
        const start = Math.min(anchorIndex, targetIndex);
        const end = Math.max(anchorIndex, targetIndex);
        const range = visible.slice(start, end + 1).map((candidate) => candidate.path);
        selectedPaths = additive ? [...new Set([...selectedPaths, ...range])] : range;
        selectedDirectory = node.isDirectory ? node.path : parentPath(node.path);
      }
      return true;
    }
    if (additive) {
      selectedPaths = selectedPathSet.has(node.path)
        ? selectedPaths.filter((path) => path !== node.path)
        : [...selectedPaths, node.path];
      selectionAnchorPath = node.path;
      selectedDirectory = node.isDirectory ? node.path : parentPath(node.path);
      return true;
    }
    setSingleSelection(node);
    return false;
  }

  function canDropInto(destination: string): boolean {
    const destinationPath = normalizedPath(destination);
    if (!draggedNodes.length) return false;
    if (
      draggedNodes.some((source) => {
        if (!source.isDirectory) return false;
        const sourcePath = normalizedPath(source.path);
        return destinationPath === sourcePath || destinationPath.startsWith(`${sourcePath}/`);
      })
    ) {
      return false;
    }
    return draggedNodes.some((source) => !samePath(parentPath(source.path), destination));
  }

  function compareNodes(left: FileNode, right: FileNode): number {
    if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  }

  function preserveDirectoryState(current: FileNode[], refreshed: FileNode[]): FileNode[] {
    return refreshed.map((node) => {
      if (!node.isDirectory) return node;
      const existing = current.find(
        (candidate) => candidate.isDirectory && samePath(candidate.path, node.path),
      );
      if (!existing) return node;
      return {
        ...node,
        expanded: existing.expanded,
        loading: existing.loading,
        loaded: existing.loaded,
        children: existing.children,
      };
    });
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
    node.name = pathName(newPath);
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
  }

  function rewriteSelectionAfterMoves(moves: readonly WorkspaceMove[]) {
    function rewritten(path: string): string {
      const move = moves.find(
        (candidate) => samePath(candidate.path, path) || isDescendantPath(candidate.path, path),
      );
      return move ? `${move.newPath}${path.slice(move.path.length)}` : path;
    }
    selectedPaths = selectedPaths.map(rewritten);
    if (selectionAnchorPath) selectionAnchorPath = rewritten(selectionAnchorPath);
  }

  async function moveNodesToDirectory(nodes: readonly FileNode[], destination: string) {
    const root = $sidebarState.workspacePath;
    if (!root || !nodes.length) return;
    await run(async () => {
      const requestedDirectory = relativeWorkspacePath(root, destination) || '.';
      const result = await moveWorkspaceEntries(
        root,
        nodes.map((node) => ({ path: node.path, isDirectory: node.isDirectory })),
        requestedDirectory,
      );
      for (const move of result.moved) {
        applyTreeMove(move.path, move.newPath, destination);
        await onRenamed(move.path, move.newPath, move.isDirectory);
      }
      rewriteSelectionAfterMoves(result.moved);
      selectedDirectory = destination;
      if (result.error) throw result.error;
    });
  }

  function beginDrag(node: FileNode, event: DragEvent) {
    if (!selectedPathSet.has(node.path)) setSingleSelection(node);
    draggedNodes = selectedOperationNodes();
    draggedPaths = [...selectedPaths];
    dropTargetPath = null;
    contextMenu = null;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = node.type === 'image' ? 'copyMove' : 'move';
      event.dataTransfer.setData(WORKSPACE_ENTRY_DRAG_TYPE, node.path);
      if (node.type === 'image') {
        event.dataTransfer.setData(WORKSPACE_IMAGE_DRAG_TYPE, node.path);
      }
    }
  }

  function endDrag() {
    draggedNodes = [];
    draggedPaths = [];
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
    const sources = draggedNodes;
    const valid = sources.length > 0 && node.isDirectory && canDropInto(node.path);
    endDrag();
    if (valid) void moveNodesToDirectory(sources, node.path);
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
    const sources = draggedNodes;
    const root = $sidebarState.workspacePath;
    const valid = sources.length > 0 && root && canDropInto(root);
    endDrag();
    if (root && valid) void moveNodesToDirectory(sources, root);
  }

  async function refreshDirectory(path: string, preserveExpanded = false) {
    const root = $sidebarState.workspacePath;
    if (!root) return;
    if (path === root) {
      if (!preserveExpanded) {
        await loadRoot();
        return;
      }
      loading = true;
      try {
        entries = preserveDirectoryState(entries, await readWorkspaceDirectory(root, root));
        clearSelection();
      } finally {
        loading = false;
      }
      return;
    }
    const node = findDirectory(entries, path);
    if (!node) {
      await loadRoot();
      return;
    }
    const refreshed = await readWorkspaceDirectory(root, path);
    node.children = preserveExpanded ? preserveDirectoryState(node.children, refreshed) : refreshed;
    node.loaded = true;
    node.expanded = true;
  }

  function operationDirectory(): string | null {
    if (selectedPaths.length !== 1) return $sidebarState.workspacePath;
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
      await refreshDirectory(parent, true);
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
      await refreshDirectory(parent, true);
    });
  }

  async function renameSelected() {
    const root = $sidebarState.workspacePath;
    const nodes = nodesForPaths(selectedPaths);
    const node = nodes.length === 1 ? nodes[0] : null;
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
      const oldPath = node.path;
      const newPath = await renameWorkspaceEntry(root, oldPath, name, node.isDirectory, node.type);
      const move = { path: oldPath, newPath, isDirectory: node.isDirectory };
      applyTreeMove(oldPath, newPath, parentPath(newPath));
      rewriteSelectionAfterMoves([move]);
      selectedDirectory = node.isDirectory ? newPath : parentPath(newPath);
      await onRenamed(oldPath, newPath, node.isDirectory);
    });
  }

  async function moveSelected() {
    const root = $sidebarState.workspacePath;
    const nodes = selectedOperationNodes();
    if (!root || !nodes.length) return;
    const destination = await dialogService.prompt({
      title: 'Move',
      message:
        nodes.length === 1
          ? 'Enter a destination folder relative to the workspace. Use . for the root.'
          : `Move ${nodes.length} selected items. Enter a destination folder relative to the workspace.`,
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
    await moveNodesToDirectory(nodes, destinationPath);
  }

  async function deleteSelected() {
    const root = $sidebarState.workspacePath;
    const nodes = selectedOperationNodes();
    if (!root || !nodes.length) return;
    const single = nodes.length === 1 ? nodes[0] : null;
    const label = single
      ? single.isDirectory
        ? `the folder “${single.name}” and all its contents`
        : `“${single.name}”`
      : `${nodes.length} selected items${nodes.some((node) => node.isDirectory) ? ', including folder contents' : ''}`;
    const confirmed = await dialogService.confirm({
      title: single
        ? single.isDirectory
          ? 'Delete Folder'
          : 'Delete File'
        : 'Delete Selected Items',
      message: `Delete ${label}? This action cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) return;
    for (const node of nodes) {
      if (!(await onBeforeDelete(node.path, node.isDirectory))) return;
    }
    await run(async () => {
      for (const node of nodes) {
        await removeWorkspaceEntry(root, node.path, node.isDirectory);
        detachNode(entries, node.path);
        selectedPaths = selectedPaths.filter(
          (path) => !samePath(path, node.path) && !isDescendantPath(node.path, path),
        );
        onDeleted(node.path, node.isDirectory);
      }
      clearSelection();
    });
  }

  function activateNode(node: FileNode, event: MouseEvent) {
    const selectionOnly = updateSelectionForClick(node, event);
    if (selectionOnly) return;
    if (node.isDirectory) void toggleDirectory(node);
    else openFile(node);
  }

  function openFile(node: FileNode) {
    void onOpenFile(node.path);
  }

  function openNodeContextMenu(node: FileNode, event: MouseEvent) {
    if (!selectedPathSet.has(node.path)) setSingleSelection(node);
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
    if (selectedPaths.length > 1) return multiContextItems;
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

  function selectAllVisible() {
    const visible = visibleNodes();
    selectedPaths = visible.map((node) => node.path);
    selectionAnchorPath = visible.at(-1)?.path ?? null;
    selectedDirectory = $sidebarState.workspacePath;
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
      selectAllVisible();
    } else if (event.key === 'Delete' && selectedPaths.length) {
      event.preventDefault();
      event.stopPropagation();
      void deleteSelected();
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
    void refreshDirectory(request.path);
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
    selectedDirectory = path;
    selectedPaths = [];
    selectionAnchorPath = null;
    contextMenu = null;
    endDrag();
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
    </div>
    <button class="change-workspace" onclick={selectWorkspace}>Open Folder</button>
  {:else}
    <div class="explorer-heading">
      <button
        class="workspace-label"
        class:drop-target={dropTargetPath === $sidebarState.workspacePath}
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
      class:loading
      class:drop-target-root={dropTargetPath === $sidebarState.workspacePath}
      ondragover={dragOverRoot}
      ondragleave={dragLeaveRoot}
      ondrop={dropOnRoot}
      onclick={clearSelectionFromBlankArea}
      onkeydown={handleExplorerKeydown}
    >
      <FileTree
        nodes={entries}
        {activePath}
        selectedPaths={selectedPathSet}
        draggedPaths={draggedPathSet}
        onActivate={activateNode}
        onContextMenu={openNodeContextMenu}
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
