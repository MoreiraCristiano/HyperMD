import { dirname } from '@tauri-apps/api/path';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import { relativeMarkdownImagePath, resolveMarkdownImagePath } from '../images/localImage';

export type ImageReferenceRewrite = {
  state: EditorState;
  changed: boolean;
};

function comparablePath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return /^[A-Za-z]:/.test(normalized) ? normalized.toLowerCase() : normalized;
}

function sourceSuffix(source: string): string {
  const index = source.search(/[?#]/);
  return index === -1 ? '' : source.slice(index);
}

export async function rewriteImageReferences(
  state: EditorState,
  documentPath: string,
  oldImagePath: string,
  newImagePath: string,
): Promise<ImageReferenceRewrite> {
  const images: Array<{ node: ProseMirrorNode; position: number; source: string }> = [];
  state.doc.descendants((node, position) => {
    if (node.type.name === 'image' && typeof node.attrs.src === 'string') {
      images.push({ node, position, source: node.attrs.src });
    }
  });
  if (images.length === 0) return { state, changed: false };

  const destination = relativeMarkdownImagePath(await dirname(documentPath), newImagePath);
  const oldComparable = comparablePath(oldImagePath);
  const resolved = await Promise.all(
    images.map(({ source }) => resolveMarkdownImagePath(source, documentPath)),
  );
  let transaction = state.tr;
  for (let index = 0; index < images.length; index += 1) {
    const absolutePath = resolved[index];
    if (!absolutePath || comparablePath(absolutePath) !== oldComparable) continue;
    const { node, position, source } = images[index];
    transaction = transaction.setNodeMarkup(
      position,
      undefined,
      { ...node.attrs, src: `${destination}${sourceSuffix(source)}` },
      node.marks,
    );
  }
  return transaction.docChanged
    ? { state: state.apply(transaction), changed: true }
    : { state, changed: false };
}
