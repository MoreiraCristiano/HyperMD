import type { FileNode, WorkspaceMove } from './workspaceService';

export function normalizedPath(path: string): string {
  const value = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[A-Za-z]:/.test(value) ? value.toLowerCase() : value;
}

export function samePath(left: string, right: string): boolean {
  return normalizedPath(left) === normalizedPath(right);
}

export function isDescendantPath(parent: string, path: string): boolean {
  const normalizedParent = normalizedPath(parent);
  const normalizedChild = normalizedPath(path);
  return normalizedChild !== normalizedParent && normalizedChild.startsWith(`${normalizedParent}/`);
}

export function parentPath(path: string): string {
  return path.replace(/[\\/][^\\/]+$/, '');
}

export function findNode(nodes: FileNode[], path: string): FileNode | null {
  for (const node of nodes) {
    if (samePath(node.path, path)) return node;
    const nested = findNode(node.children, path);
    if (nested) return nested;
  }
  return null;
}

export function findDirectory(nodes: FileNode[], path: string): FileNode | null {
  const node = findNode(nodes, path);
  return node?.isDirectory ? node : null;
}

export function visibleNodes(nodes: FileNode[]): FileNode[] {
  const visible: FileNode[] = [];
  for (const node of nodes) {
    visible.push(node);
    if (node.isDirectory && node.expanded) visible.push(...visibleNodes(node.children));
  }
  return visible;
}

export function nodesForPaths(nodes: FileNode[], paths: readonly string[]): FileNode[] {
  const requested = new Set(paths);
  const matches: FileNode[] = [];
  function visit(children: FileNode[]): void {
    for (const node of children) {
      if (requested.has(node.path)) matches.push(node);
      if (node.children.length) visit(node.children);
    }
  }
  visit(nodes);
  return matches;
}

export function selectedOperationNodes(
  nodes: FileNode[],
  selectedPaths: readonly string[],
): FileNode[] {
  const selected = new Set(selectedPaths);
  const matches: FileNode[] = [];
  function visit(children: FileNode[], selectedAncestor: boolean): void {
    for (const node of children) {
      const isSelected = selected.has(node.path);
      if (isSelected && !selectedAncestor) matches.push(node);
      if (node.children.length) {
        visit(node.children, selectedAncestor || (isSelected && node.isDirectory));
      }
    }
  }
  visit(nodes, false);
  return matches;
}

export function canDropInto(nodes: readonly FileNode[], destination: string): boolean {
  const destinationPath = normalizedPath(destination);
  if (!nodes.length) return false;
  if (
    nodes.some((source) => {
      if (!source.isDirectory) return false;
      const sourcePath = normalizedPath(source.path);
      return destinationPath === sourcePath || destinationPath.startsWith(`${sourcePath}/`);
    })
  ) {
    return false;
  }
  return nodes.some((source) => !samePath(parentPath(source.path), destination));
}

export function compareNodes(left: FileNode, right: FileNode): number {
  if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
}

export function preserveDirectoryState(current: FileNode[], refreshed: FileNode[]): FileNode[] {
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

export function detachNode(nodes: FileNode[], path: string): FileNode | null {
  const index = nodes.findIndex((node) => samePath(node.path, path));
  if (index !== -1) return nodes.splice(index, 1)[0];
  for (const node of nodes) {
    const detached = detachNode(node.children, path);
    if (detached) return detached;
  }
  return null;
}

export function rewriteNodePaths(node: FileNode, oldPath: string, newPath: string): void {
  node.path = `${newPath}${node.path.slice(oldPath.length)}`;
  node.children.forEach((child) => rewriteNodePaths(child, oldPath, newPath));
}

export function rewriteMovedPath(path: string, moves: readonly WorkspaceMove[]): string {
  const move = moves.find(
    (candidate) => samePath(candidate.path, path) || isDescendantPath(candidate.path, path),
  );
  return move ? `${move.newPath}${path.slice(move.path.length)}` : path;
}
