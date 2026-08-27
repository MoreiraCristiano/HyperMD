<script lang="ts">
  import FileTree from './FileTree.svelte';
  import type { FileNode } from './workspace';

  type Props = {
    node: FileNode;
    level: number;
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
    node,
    level,
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

  function activate(event: MouseEvent) {
    onActivate(node, event);
  }
</script>

<button
  class="tree-item"
  class:active={activePath === node.path}
  class:selected={selectedPaths.has(node.path)}
  class:dragging={draggedPaths.has(node.path)}
  class:drop-target={node.isDirectory && dropTargetPath === node.path}
  style:padding-left={`${7 + level * 13}px`}
  draggable="true"
  onclick={activate}
  ondragstart={(event) => onDragStart(node, event)}
  ondragend={onDragEnd}
  ondragover={(event) => onDragOver(node, event)}
  ondragleave={(event) => onDragLeave(node, event)}
  ondrop={(event) => onDrop(node, event)}
  oncontextmenu={(event) => {
    event.preventDefault();
    event.currentTarget.focus();
    onContextMenu(node, event);
  }}
  title={node.path}
  role="treeitem"
  aria-selected={selectedPaths.has(node.path)}
  aria-expanded={node.isDirectory ? node.expanded : undefined}
>
  <span class="tree-chevron" class:expanded={node.expanded}>
    {#if node.isDirectory}
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m4 2 4 4-4 4" /></svg>
    {/if}
  </span>
  <span
    class="tree-icon"
    class:folder={node.isDirectory}
    class:image={node.type === 'image'}
    aria-hidden="true"
  >
    {#if node.isDirectory}
      <svg viewBox="0 0 16 16"><path d="M1.5 3.5h5l1.5 2h6.5v7h-13z" /></svg>
    {:else if node.type === 'image'}
      <svg viewBox="0 0 16 16"
        ><path d="M2 2.5h12v11H2zM4.5 5.5h.01M3.5 11l3-3 2 2 1.5-1.5 2.5 2.5" /></svg
      >
    {:else}
      <svg viewBox="0 0 16 16"><path d="M3 1.5h6l4 4v9H3zM9 1.5v4h4" /></svg>
    {/if}
  </span>
  <span class="tree-label">{node.name}</span>
  {#if node.loading}<span class="tree-loading">…</span>{/if}
</button>

{#if node.isDirectory && node.expanded && node.children.length}
  <FileTree
    nodes={node.children}
    level={level + 1}
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
{/if}
