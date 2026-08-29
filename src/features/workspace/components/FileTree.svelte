<script lang="ts">
  import FileTreeItem from './FileTreeItem.svelte';
  import type { FileNode } from '../workspaceService';

  type Props = {
    nodes: FileNode[];
    level?: number;
    activePath: string | null;
    selectedPaths: ReadonlySet<string>;
    draggedPaths: ReadonlySet<string>;
    onActivate: (node: FileNode, event: MouseEvent) => void;
    onContextMenu: (node: FileNode, event: MouseEvent) => void;
    dropTargetPath: string | null;
    onDragStart: (node: FileNode, event: DragEvent) => void;
    onDragEnd: () => void;
    onDragOver: (node: FileNode, event: DragEvent) => void;
    onDragLeave: (node: FileNode, event: DragEvent) => void;
    onDrop: (node: FileNode, event: DragEvent) => void;
  };

  let {
    nodes,
    level = 0,
    activePath,
    selectedPaths,
    draggedPaths,
    onActivate,
    onContextMenu,
    dropTargetPath,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragLeave,
    onDrop,
  }: Props = $props();
</script>

<div class="file-tree" role="group">
  {#each nodes as node (node.path)}
    <FileTreeItem
      {node}
      {level}
      {activePath}
      {selectedPaths}
      {draggedPaths}
      {onActivate}
      {onContextMenu}
      {dropTargetPath}
      {onDragStart}
      {onDragEnd}
      {onDragOver}
      {onDragLeave}
      {onDrop}
    />
  {/each}
</div>
