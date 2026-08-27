<script lang="ts">
  import FileTree from './FileTree.svelte';
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

  let { activePath, onOpenFile, onBeforeDelete, onDeleted, onRenamed, onError }: Props = $props();
  let entries = $state<FileNode[]>([]);
  let selectedNode = $state<FileNode | null>(null);
  let selectedDirectory = $state<string | null>(null);
  let loading = $state(false);
  let handledWorkspaceRequest = 0;
  let loadedWorkspacePath: string | null = null;
  let handledRefreshRequest = 0;

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
      if (node.isDirectory && node.path === path) return node;
      const nested = findDirectory(node.children, path);
      if (nested) return nested;
    }
    return null;
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
    const name = window.prompt('Markdown file name:', 'new-file.md');
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
    const name = window.prompt('Folder name:', 'new-folder');
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
    const name = window.prompt('New name:', node.name);
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
    const destination = window.prompt(
      'Destination folder relative to the workspace (use . for the root):',
      '.',
    );
    if (destination === null) return;
    await run(async () => {
      const newPath = await moveWorkspaceEntry(root, node.path, destination);
      if (newPath === node.path) return;
      onRenamed(node.path, newPath, node.isDirectory);
      selectedNode = null;
      selectedDirectory = root;
      await loadRoot();
    });
  }

  async function deleteSelected() {
    const root = $sidebarState.workspacePath;
    const node = selectedNode;
    if (!root || !node) return;
    const label = node.isDirectory
      ? `the folder “${node.name}” and all its contents`
      : `“${node.name}”`;
    if (!window.confirm(`Delete ${label}? This action cannot be undone.`)) return;
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
    entries = [];
    if (path) void loadRoot();
  });
</script>

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
      onclick={() => {
        selectedDirectory = $sidebarState.workspacePath;
        selectedNode = null;
      }}
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
      <button onclick={renameSelected} disabled={!selectedNode} title="Rename" aria-label="Rename">
        <svg viewBox="0 0 16 16"><path d="m3 11 8-8 2 2-8 8-3 1zM9.5 4.5l2 2" /></svg>
      </button>
      <button onclick={moveSelected} disabled={!selectedNode} title="Move" aria-label="Move">
        <svg viewBox="0 0 16 16"><path d="M1.5 4h5l1.5 2h6.5v6.5h-13zM6 9h5M9 7l2 2-2 2" /></svg>
      </button>
      <button onclick={deleteSelected} disabled={!selectedNode} title="Delete" aria-label="Delete">
        <svg viewBox="0 0 16 16"><path d="M3 4h10M6 2h4l1 2H5zM5 6v7h6V6M7 7v4M9 7v4" /></svg>
      </button>
      <button onclick={refresh} title="Refresh" aria-label="Refresh">
        <svg viewBox="0 0 16 16"><path d="M13 5V2l-1.3 1.3A5.5 5.5 0 1 0 13 9M13 2H9" /></svg>
      </button>
    </div>
  </div>
  <div class="explorer-tree" class:loading>
    <FileTree
      nodes={entries}
      {activePath}
      selectedPath={selectedNode?.path ?? null}
      onToggle={(node) => void toggleDirectory(node)}
      onOpenFile={openFile}
      onSelectDirectory={selectDirectory}
      onSelectFile={selectFile}
    />
  </div>
  <button class="change-workspace" onclick={selectWorkspace}>Open Another Folder…</button>
{/if}
