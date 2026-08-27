import {
  Extension,
  type Editor,
  type Extensions,
  type JSONContent,
  type MarkdownRendererHelpers,
  type NodeViewRendererProps,
} from '@tiptap/core';
import { Table, TableCell, TableHeader, TableRow, updateColumns } from '@tiptap/extension-table';
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Selection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { TableMap, addRowAfter as addProseMirrorRowAfter } from '@tiptap/pm/tables';
import type { EditorView, NodeView, ViewMutationRecord } from '@tiptap/pm/view';

export type TableAlignment = 'left' | 'center' | 'right';

export type TableContext = {
  table: ProseMirrorNode;
  tablePos: number;
  row: number;
  column: number;
  width: number;
  height: number;
};

type Dispatch = (transaction: Transaction) => void;

export const TABLE_MODE_EXIT = 'hypermdTableModeExit';
export const TABLE_MODE_ENTER = 'hypermdTableModeEnter';

export function canInsertMarkdownTable(editor: Editor): boolean {
  return (
    findTableContext(editor.state) === null &&
    editor.can().insertTable({ rows: 1, cols: 1, withHeaderRow: true })
  );
}

export function insertMarkdownTable(editor: Editor, rows: number, columns: number): boolean {
  if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || columns < 1)
    return false;
  if (!canInsertMarkdownTable(editor)) return false;
  return editor
    .chain()
    .focus()
    .insertTable({ rows, cols: columns, withHeaderRow: true })
    .command(({ tr }) => {
      tr.setMeta(TABLE_MODE_ENTER, true);
      return true;
    })
    .run();
}

function escapeCellPipes(value: string): string {
  return value.replace(/\\\||\|/g, (match) => (match === '|' ? '\\|' : match));
}

export function renderMarkdownTable(node: JSONContent, helpers: MarkdownRendererHelpers): string {
  const rows = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) => {
      const rendered = cell.content ? helpers.renderChildren(cell.content) : '';
      return {
        text: escapeCellPipes(
          rendered
            .replace(/[ \t]*\r?\n[ \t]*/g, '<br>')
            .replace(/\s+/g, ' ')
            .trim(),
        ),
        header: cell.type === 'tableHeader',
        align: cell.attrs?.align as TableAlignment | null | undefined,
      };
    }),
  );
  if (!rows.length) return '';
  const columnCount = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  if (!columnCount) return '';
  const widths = Array.from({ length: columnCount }, (_, column) =>
    Math.max(3, ...rows.map((row) => row[column]?.text.length ?? 0)),
  );
  const pad = (value: string, width: number): string => value.padEnd(width, ' ');
  const header = rows[0].some((cell) => cell.header) ? rows[0] : [];
  const alignments = Array.from<TableAlignment | null>({ length: columnCount }).fill(null);
  for (const row of rows) {
    row.forEach((cell, column) => {
      if (!alignments[column] && cell.align) alignments[column] = cell.align;
    });
  }
  const renderRow = (row: (typeof rows)[number]): string =>
    `| ${Array.from({ length: columnCount }, (_, column) =>
      pad(row[column]?.text ?? '', widths[column]),
    ).join(' | ')} |`;
  const separator = `| ${widths
    .map((width, column) => {
      const dashes = '-'.repeat(width);
      if (alignments[column] === 'left') return `:${dashes}`;
      if (alignments[column] === 'center') return `:${dashes}:`;
      if (alignments[column] === 'right') return `${dashes}:`;
      return dashes;
    })
    .join(' | ')} |`;
  const body = header.length ? rows.slice(1) : rows;
  const headerCells = header.length
    ? header
    : Array.from({ length: columnCount }, () => ({ text: '', header: true, align: null }));
  return `\n${[renderRow(headerCells), separator, ...body.map(renderRow)].join('\n')}\n`;
}

export function findTableContext(state: EditorState): TableContext | null {
  const { $from } = state.selection;
  let tableDepth = -1;
  let cellDepth = -1;

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const role = $from.node(depth).type.spec.tableRole;
    if (cellDepth === -1 && (role === 'cell' || role === 'header_cell')) cellDepth = depth;
    if (role === 'table') {
      tableDepth = depth;
      break;
    }
  }

  if (tableDepth === -1 || cellDepth === -1) return null;
  const table = $from.node(tableDepth);
  const tablePos = $from.before(tableDepth);
  const tableStart = $from.start(tableDepth);
  const cellPos = $from.before(cellDepth) - tableStart;
  const map = TableMap.get(table);
  const rect = map.findCell(cellPos);

  return {
    table,
    tablePos,
    row: rect.top,
    column: rect.left,
    width: map.width,
    height: map.height,
  };
}

function setCellSelection(
  transaction: Transaction,
  tablePos: number,
  table: ProseMirrorNode,
  row: number,
  column: number,
): void {
  const map = TableMap.get(table);
  const relativeCellPos = map.positionAt(row, column, table);
  const cellPos = tablePos + 1 + relativeCellPos;
  transaction.setSelection(TextSelection.near(transaction.doc.resolve(cellPos + 1), 1));
}

function replaceTable(
  state: EditorState,
  dispatch: Dispatch | undefined,
  context: TableContext,
  table: ProseMirrorNode,
  row: number,
  column: number,
): boolean {
  if (!dispatch) return true;
  const transaction = state.tr.replaceWith(
    context.tablePos,
    context.tablePos + context.table.nodeSize,
    table,
  );
  setCellSelection(transaction, context.tablePos, table, row, column);
  dispatch(transaction.scrollIntoView());
  return true;
}

function rectangularRows(table: ProseMirrorNode, width: number): ProseMirrorNode[] | null {
  const rows: ProseMirrorNode[] = [];
  table.forEach((row) => {
    let rectangular = row.childCount === width;
    for (let index = 0; index < row.childCount; index += 1) {
      const cell = row.child(index);
      if (cell.attrs.colspan !== 1 || cell.attrs.rowspan !== 1) rectangular = false;
    }
    if (rectangular) rows.push(row);
  });
  return rows.length === table.childCount ? rows : null;
}

export function moveTableRow(
  state: EditorState,
  dispatch: Dispatch | undefined,
  direction: -1 | 1,
): boolean {
  const context = findTableContext(state);
  if (!context || context.row === 0) return false;
  const target = context.row + direction;
  if (target < 1 || target >= context.height) return false;

  const rows: ProseMirrorNode[] = [];
  context.table.forEach((row) => rows.push(row));
  [rows[context.row], rows[target]] = [rows[target], rows[context.row]];
  const table = context.table.copy(Fragment.fromArray(rows));
  return replaceTable(state, dispatch, context, table, target, context.column);
}

export function moveTableColumn(
  state: EditorState,
  dispatch: Dispatch | undefined,
  direction: -1 | 1,
): boolean {
  const context = findTableContext(state);
  if (!context) return false;
  const target = context.column + direction;
  if (target < 0 || target >= context.width) return false;
  const rows = rectangularRows(context.table, context.width);
  if (!rows) return false;

  const movedRows = rows.map((row) => {
    const cells: ProseMirrorNode[] = [];
    row.forEach((cell) => cells.push(cell));
    [cells[context.column], cells[target]] = [cells[target], cells[context.column]];
    return row.copy(Fragment.fromArray(cells));
  });
  const table = context.table.copy(Fragment.fromArray(movedRows));
  return replaceTable(state, dispatch, context, table, context.row, target);
}

export function alignTableColumn(
  state: EditorState,
  dispatch: Dispatch | undefined,
  alignment: TableAlignment,
): boolean {
  const context = findTableContext(state);
  if (!context) return false;
  const rows = rectangularRows(context.table, context.width);
  if (!rows) return false;

  const alignedRows = rows.map((row) => {
    const cells: ProseMirrorNode[] = [];
    for (let index = 0; index < row.childCount; index += 1) {
      const cell = row.child(index);
      cells.push(
        index === context.column
          ? cell.type.create({ ...cell.attrs, align: alignment }, cell.content, cell.marks)
          : cell,
      );
    }
    return row.copy(Fragment.fromArray(cells));
  });
  const table = context.table.copy(Fragment.fromArray(alignedRows));
  return replaceTable(state, dispatch, context, table, context.row, context.column);
}

export function addTableRowAndFocus(editor: Editor): boolean {
  const context = findTableContext(editor.state);
  if (!context) return false;
  return addProseMirrorRowAfter(editor.state, (transaction) => {
    const table = transaction.doc.nodeAt(context.tablePos);
    if (!table) return;
    setCellSelection(transaction, context.tablePos, table, context.row + 1, context.column);
    editor.view.dispatch(transaction.scrollIntoView());
    editor.view.focus();
  });
}

function moveSelectionAfterTable(view: EditorView, getPos: NodeViewRendererProps['getPos']): void {
  const position = getPos();
  if (typeof position !== 'number') return;
  const table = view.state.doc.nodeAt(position);
  if (!table) return;
  let transaction = view.state.tr;
  let after = position + table.nodeSize;

  if (after >= transaction.doc.content.size) {
    const paragraph = view.state.schema.nodes.paragraph?.create();
    if (paragraph) {
      transaction = transaction.insert(after, paragraph);
      after += 1;
    }
  }

  transaction.setSelection(Selection.near(transaction.doc.resolve(after), 1));
  transaction.setMeta(TABLE_MODE_EXIT, true);
  view.dispatch(transaction.scrollIntoView());
  view.focus();
}

type TableButton = {
  element: HTMLButtonElement;
};

export class MarkdownTableView implements NodeView {
  node: ProseMirrorNode;
  dom: HTMLDivElement;
  contentDOM: HTMLTableSectionElement;
  private readonly table: HTMLTableElement;
  private readonly colgroup: HTMLTableColElement;
  private readonly toolbar: HTMLDivElement;
  private readonly editor: Editor;
  private readonly outerView: EditorView;
  private readonly getPos: NodeViewRendererProps['getPos'];
  private readonly buttons = new Map<string, TableButton>();
  private active = false;
  private readonly activateView: (view: MarkdownTableView) => void;
  private readonly deactivateView: (view: MarkdownTableView, synchronize: boolean) => void;
  private readonly removeView: (view: MarkdownTableView) => void;

  constructor(
    props: NodeViewRendererProps,
    activateView: (view: MarkdownTableView) => void,
    deactivateView: (view: MarkdownTableView, synchronize: boolean) => void,
    removeView: (view: MarkdownTableView) => void,
  ) {
    this.node = props.node;
    this.editor = props.editor;
    this.outerView = props.view;
    this.getPos = props.getPos;
    this.activateView = activateView;
    this.deactivateView = deactivateView;
    this.removeView = removeView;

    this.dom = document.createElement('div');
    this.dom.className = 'hypermd-table-wrapper';
    this.toolbar = this.dom.appendChild(document.createElement('div'));
    this.toolbar.className = 'hypermd-table-toolbar';
    this.toolbar.contentEditable = 'false';
    this.toolbar.setAttribute('role', 'toolbar');
    this.toolbar.setAttribute('aria-label', 'Table editing controls');
    this.buildToolbar();

    const viewport = this.dom.appendChild(document.createElement('div'));
    viewport.className = 'hypermd-table-viewport';
    this.table = viewport.appendChild(document.createElement('table'));
    this.table.className = 'hypermd-table';
    for (const [key, value] of Object.entries(props.HTMLAttributes)) {
      if (value === undefined || value === null) continue;
      if (key === 'style') this.table.style.cssText = String(value);
      else this.table.setAttribute(key, String(value));
    }
    if (props.node.attrs.style) this.table.style.cssText = props.node.attrs.style;
    this.colgroup = this.table.appendChild(document.createElement('colgroup'));
    updateColumns(props.node, this.colgroup, this.table, 90);
    this.contentDOM = this.table.appendChild(document.createElement('tbody'));

    this.table.addEventListener('pointerdown', this.activate);
    this.dom.addEventListener('keydown', this.handleKeydown);
    this.editor.on('selectionUpdate', this.handleSelectionUpdate);
  }

  private createGroup(label: string): HTMLDivElement {
    const group = document.createElement('div');
    group.className = 'hypermd-table-toolbar-group';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    this.toolbar.appendChild(group);
    return group;
  }

  private addButton(
    group: HTMLElement,
    key: string,
    label: string,
    text: string,
    action: () => boolean,
  ): void {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'hypermd-table-action';
    element.title = label;
    element.setAttribute('aria-label', label);
    element.textContent = text;
    element.addEventListener('pointerdown', (event) => event.preventDefault());
    element.addEventListener('click', () => {
      if (element.disabled) return;
      action();
      this.outerView.focus();
      this.refresh();
    });
    group.appendChild(element);
    this.buttons.set(key, { element });
  }

  private buildToolbar(): void {
    const rows = this.createGroup('Rows');
    this.addButton(rows, 'addRow', 'Add row below', '+R', () => addTableRowAndFocus(this.editor));
    this.addButton(rows, 'deleteRow', 'Remove row', '−R', () => this.editor.commands.deleteRow());
    this.addButton(rows, 'rowUp', 'Move row up', '↑', () =>
      moveTableRow(this.editor.state, (transaction) => this.outerView.dispatch(transaction), -1),
    );
    this.addButton(rows, 'rowDown', 'Move row down', '↓', () =>
      moveTableRow(this.editor.state, (transaction) => this.outerView.dispatch(transaction), 1),
    );

    const columns = this.createGroup('Columns');
    this.addButton(columns, 'addColumn', 'Add column right', '+C', () =>
      this.editor.commands.addColumnAfter(),
    );
    this.addButton(columns, 'deleteColumn', 'Remove column', '−C', () =>
      this.editor.commands.deleteColumn(),
    );
    this.addButton(columns, 'columnLeft', 'Move column left', '←', () =>
      moveTableColumn(this.editor.state, (transaction) => this.outerView.dispatch(transaction), -1),
    );
    this.addButton(columns, 'columnRight', 'Move column right', '→', () =>
      moveTableColumn(this.editor.state, (transaction) => this.outerView.dispatch(transaction), 1),
    );

    const alignment = this.createGroup('Column alignment');
    this.addButton(alignment, 'left', 'Align column left', 'L', () =>
      alignTableColumn(
        this.editor.state,
        (transaction) => this.outerView.dispatch(transaction),
        'left',
      ),
    );
    this.addButton(alignment, 'center', 'Align column center', 'C', () =>
      alignTableColumn(
        this.editor.state,
        (transaction) => this.outerView.dispatch(transaction),
        'center',
      ),
    );
    this.addButton(alignment, 'right', 'Align column right', 'R', () =>
      alignTableColumn(
        this.editor.state,
        (transaction) => this.outerView.dispatch(transaction),
        'right',
      ),
    );
  }

  private activate = (): void => this.activateView(this);

  private handleSelectionUpdate = (): void => {
    if (this.active) this.refresh();
  };

  private handleDocumentPointerDown = (event: PointerEvent): void => {
    if (event.target instanceof Node && !this.dom.contains(event.target)) {
      this.deactivateView(this, true);
    }
  };

  private handleKeydown = (event: KeyboardEvent): void => {
    if (!this.active || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    this.deactivateView(this, false);
    moveSelectionAfterTable(this.outerView, this.getPos);
  };

  setActive(active: boolean, synchronize = false): void {
    if (this.active === active) return;
    this.active = active;
    this.dom.classList.toggle('active', active);
    if (active) {
      document.addEventListener('pointerdown', this.handleDocumentPointerDown, true);
      this.refresh();
    } else {
      document.removeEventListener('pointerdown', this.handleDocumentPointerDown, true);
      if (synchronize) {
        this.outerView.dispatch(this.outerView.state.tr.setMeta(TABLE_MODE_EXIT, true));
      }
    }
  }

  refresh(): void {
    const context = findTableContext(this.editor.state);
    const position = this.getPos();
    const ownsSelection =
      context !== null && typeof position === 'number' && context.tablePos === position;
    this.toolbar.toggleAttribute('data-has-cell', ownsSelection);
    for (const cell of this.contentDOM.querySelectorAll('.hypermd-table-current-cell')) {
      cell.classList.remove('hypermd-table-current-cell');
    }
    if (!ownsSelection || !context) return;

    const currentRow = this.contentDOM.rows.item(context.row);
    currentRow?.cells.item(context.column)?.classList.add('hypermd-table-current-cell');

    this.setDisabled('deleteRow', context.row === 0);
    this.setDisabled('rowUp', context.row <= 1);
    this.setDisabled('rowDown', context.row === 0 || context.row >= context.height - 1);
    this.setDisabled('deleteColumn', context.width <= 1);
    this.setDisabled('columnLeft', context.column <= 0);
    this.setDisabled('columnRight', context.column >= context.width - 1);

    const cell = context.table.child(context.row).child(context.column);
    const currentAlignment = cell.attrs.align ?? null;
    for (const alignment of ['left', 'center', 'right'] as const) {
      const button = this.buttons.get(alignment)?.element;
      button?.classList.toggle('active', currentAlignment === alignment);
      button?.setAttribute('aria-pressed', String(currentAlignment === alignment));
    }
  }

  private setDisabled(key: string, disabled: boolean): void {
    const button = this.buttons.get(key)?.element;
    if (button) button.disabled = disabled;
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    updateColumns(node, this.colgroup, this.table, 90);
    if (this.active) this.refresh();
    return true;
  }

  stopEvent(event: Event): boolean {
    return event.target instanceof Node && this.toolbar.contains(event.target);
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    const target = mutation.target as Node;
    return this.dom.contains(target) && !this.contentDOM.contains(target);
  }

  destroy(): void {
    this.table.removeEventListener('pointerdown', this.activate);
    this.dom.removeEventListener('keydown', this.handleKeydown);
    document.removeEventListener('pointerdown', this.handleDocumentPointerDown, true);
    this.editor.off('selectionUpdate', this.handleSelectionUpdate);
    this.deactivateView(this, false);
    this.removeView(this);
  }

  position(): number | null {
    const position = this.getPos();
    return typeof position === 'number' ? position : null;
  }
}

export function createMarkdownTableExtensions(): Extensions {
  let activeView: MarkdownTableView | null = null;
  const tableViews = new Set<MarkdownTableView>();

  const activateView = (view: MarkdownTableView): void => {
    if (activeView === view) return;
    activeView?.setActive(false, true);
    activeView = view;
    view.setActive(true);
  };

  const deactivateView = (view: MarkdownTableView, synchronize: boolean): void => {
    if (activeView !== view) return;
    activeView = null;
    view.setActive(false, synchronize);
  };

  const activateAtSelection = (editor: Editor): void => {
    const context = findTableContext(editor.state);
    if (!context) return;
    const view = [...tableViews].find((candidate) => candidate.position() === context.tablePos);
    if (view) activateView(view);
  };

  const MarkdownTable = Table.extend({
    renderMarkdown: renderMarkdownTable,
    addNodeView() {
      return (props) => {
        const view = new MarkdownTableView(props, activateView, deactivateView, (candidate) =>
          tableViews.delete(candidate),
        );
        tableViews.add(view);
        return view;
      };
    },
  });

  const TableKeyboard = Extension.create({
    name: 'tableKeyboard',
    priority: 1_000,
    onTransaction({ editor, transaction }) {
      if (!transaction.getMeta(TABLE_MODE_ENTER)) return;
      queueMicrotask(() => activateAtSelection(editor));
    },
    addKeyboardShortcuts() {
      return {
        Enter: () => addTableRowAndFocus(this.editor),
      };
    },
  });

  return [MarkdownTable, TableRow, TableHeader, TableCell, TableKeyboard];
}
