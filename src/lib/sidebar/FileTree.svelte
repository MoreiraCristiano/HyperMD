<script lang="ts">
  import FileTreeItem from './FileTreeItem.svelte';
  import type { FileNode } from './workspace';

  type Props = {
    nodes: FileNode[];
    level?: number;
    activePath: string | null;
    selectedPath: string | null;
    onToggle: (node: FileNode) => void;
    onOpenFile: (node: FileNode) => void;
    onSelectDirectory: (node: FileNode) => void;
    onSelectFile: (node: FileNode) => void;
    onContextMenu: (node: FileNode, event: MouseEvent) => void;
  };

  let {
    nodes,
    level = 0,
    activePath,
    selectedPath,
    onToggle,
    onOpenFile,
    onSelectDirectory,
    onSelectFile,
    onContextMenu,
  }: Props = $props();
</script>

<div class="file-tree" role="tree">
  {#each nodes as node (node.path)}
    <FileTreeItem
      {node}
      {level}
      {activePath}
      {selectedPath}
      {onToggle}
      {onOpenFile}
      {onSelectDirectory}
      {onSelectFile}
      {onContextMenu}
    />
  {/each}
</div>
