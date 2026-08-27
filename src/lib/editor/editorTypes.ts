import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';

export type StoredSelection = {
  anchor: number;
  head: number;
};

export type EditorCommand = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll';

export type EditorApi = {
  createState: (markdown: string, selection?: StoredSelection) => EditorState;
  getState: () => EditorState;
  setState: (state: EditorState) => void;
  serializeState: (state: EditorState) => string;
  serializeNode: (node: ProseMirrorNode) => string;
  execute: (command: EditorCommand) => Promise<boolean>;
  canInsertTable: () => boolean;
  insertTable: (rows: number, columns: number) => boolean;
  insertImage: (src: string, alt: string, selection: StoredSelection) => boolean;
  insertImageIntoState: (
    state: EditorState,
    src: string,
    alt: string,
    selection: StoredSelection,
  ) => EditorState;
  focus: () => void;
  openFind: () => void;
};
