import { canDropInto, selectedOperationNodes } from './explorerController';
import type { FileNode } from './explorerOperations';
import type { ExplorerSelection } from './explorerSelection.svelte';
import { WORKSPACE_ENTRY_DRAG_TYPE, WORKSPACE_IMAGE_DRAG_TYPE } from './components/dragTypes';

type ExplorerDragDependencies = {
  getRoot: () => string | null;
  getEntries: () => FileNode[];
  selection: ExplorerSelection;
  moveNodes: (nodes: readonly FileNode[], destination: string) => Promise<void>;
};

export class ExplorerDragController {
  nodes = $state<FileNode[]>([]);
  paths = $state<string[]>([]);
  dropTargetPath = $state<string | null>(null);
  pathSet = $derived(new Set(this.paths));

  constructor(private readonly dependencies: ExplorerDragDependencies) {}

  begin(node: FileNode, event: DragEvent): void {
    if (!this.dependencies.selection.pathSet.has(node.path)) {
      this.dependencies.selection.selectSingle(node);
    }
    this.nodes = selectedOperationNodes(
      this.dependencies.getEntries(),
      this.dependencies.selection.paths,
    );
    this.paths = [...this.dependencies.selection.paths];
    this.dropTargetPath = null;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = node.type === 'image' ? 'copyMove' : 'move';
      event.dataTransfer.setData(WORKSPACE_ENTRY_DRAG_TYPE, node.path);
      if (node.type === 'image') {
        event.dataTransfer.setData(WORKSPACE_IMAGE_DRAG_TYPE, node.path);
      }
    }
  }

  end(): void {
    this.nodes = [];
    this.paths = [];
    this.dropTargetPath = null;
  }

  overNode(node: FileNode, event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const valid = node.isDirectory && canDropInto(this.nodes, node.path);
    this.dropTargetPath = valid ? node.path : null;
    if (event.dataTransfer) event.dataTransfer.dropEffect = valid ? 'move' : 'none';
  }

  leaveNode(node: FileNode, event: DragEvent): void {
    event.stopPropagation();
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget instanceof Node) {
      if (event.currentTarget.contains(related)) return;
    }
    if (this.dropTargetPath === node.path) this.dropTargetPath = null;
  }

  dropOnNode(node: FileNode, event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const sources = this.nodes;
    const valid = sources.length > 0 && node.isDirectory && canDropInto(sources, node.path);
    this.end();
    if (valid) void this.dependencies.moveNodes(sources, node.path);
  }

  overRoot(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const root = this.dependencies.getRoot();
    const valid = Boolean(root && canDropInto(this.nodes, root));
    this.dropTargetPath = valid ? root : null;
    if (event.dataTransfer) event.dataTransfer.dropEffect = valid ? 'move' : 'none';
  }

  leaveRoot(event: DragEvent): void {
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget instanceof Node) {
      if (event.currentTarget.contains(related)) return;
    }
    if (this.dropTargetPath === this.dependencies.getRoot()) this.dropTargetPath = null;
  }

  dropOnRoot(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const sources = this.nodes;
    const root = this.dependencies.getRoot();
    const valid = sources.length > 0 && root && canDropInto(sources, root);
    this.end();
    if (root && valid) void this.dependencies.moveNodes(sources, root);
  }
}
