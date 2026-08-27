import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextSelection } from '@tiptap/pm/state';
import { TableMap } from '@tiptap/pm/tables';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkdownSupport } from './markdown';
import {
  TABLE_MODE_EXIT,
  addTableRowAndFocus,
  alignTableColumn,
  createMarkdownTableExtensions,
  findTableContext,
  insertMarkdownTable,
  moveTableColumn,
  moveTableRow,
  renderMarkdownTable,
} from './extensions/table';

const editors: Editor[] = [];

function createEditor(content: string, onTransaction = vi.fn()): Editor {
  const element = document.body.appendChild(document.createElement('div'));
  const editor = new Editor({
    element,
    extensions: [StarterKit, ...createMarkdownTableExtensions(), MarkdownSupport],
    content,
    contentType: 'markdown',
    onTransaction,
  });
  editors.push(editor);
  return editor;
}

function selectCell(editor: Editor, row: number, column: number): void {
  const table = editor.state.doc.firstChild!;
  const cell = 1 + TableMap.get(table).positionAt(row, column, table);
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(cell + 1), 1)),
  );
}

function tableText(editor: Editor): string[][] {
  const rows: string[][] = [];
  editor.state.doc.firstChild!.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => cells.push(cell.textContent));
    rows.push(cells);
  });
  return rows;
}

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
  document.body.replaceChildren();
});

describe('Markdown table editing', () => {
  const markdown = [
    '| Name | Score | Notes |',
    '| :--- | :---: | ---: |',
    '| Ana | 10 | A \\| B |',
    '| Bia | 20 | Done |',
  ].join('\n');

  it('parses and serializes GFM tables with headers, alignment, and escaped pipes', () => {
    const editor = createEditor(markdown);
    const table = editor.state.doc.firstChild!;

    expect(table.type.name).toBe('table');
    expect(table.firstChild?.firstChild?.type.name).toBe('tableHeader');
    expect(table.firstChild?.child(0).attrs.align).toBe('left');
    expect(table.firstChild?.child(1).attrs.align).toBe('center');
    expect(table.firstChild?.child(2).attrs.align).toBe('right');
    expect(table.child(1).child(2).textContent).toBe('A | B');

    const serialized = editor.markdown!.serialize(editor.getJSON());
    expect(serialized).toContain(':----');
    expect(serialized).toContain(':-----:');
    expect(serialized).toContain('-----:');
    expect(serialized).toContain('A \\| B');
  });

  it('renders empty and headerless table JSON safely', () => {
    const helpers = {
      renderChildren: (content: Array<{ text?: string }>) =>
        content.map((child) => child.text ?? '').join(''),
    } as unknown as Parameters<typeof renderMarkdownTable>[1];

    expect(renderMarkdownTable({}, helpers)).toBe('');
    expect(renderMarkdownTable({ content: [{}] }, helpers)).toBe('');

    const rendered = renderMarkdownTable(
      {
        content: [
          {
            type: 'tableRow',
            content: [{ type: 'tableCell', content: [{ type: 'text', text: 'A \\| B' }] }],
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell' },
              { type: 'tableCell', content: [{ type: 'text', text: 'X' }] },
            ],
          },
        ],
      },
      helpers,
    );

    expect(rendered.split('\n')[1]).toMatch(/^\|\s+\|\s+\|$/);
    expect(rendered).toContain('A \\| B');
    expect(rendered).toMatch(/\|\s+\|\s*X\s+\|/);
  });

  it('moves body rows while keeping the header fixed and restoring the active column', () => {
    const editor = createEditor(markdown);
    selectCell(editor, 2, 1);

    expect(moveTableRow(editor.state, undefined, -1)).toBe(true);
    expect(tableText(editor)[2][0]).toBe('Bia');
    expect(moveTableRow(editor.state, (transaction) => editor.view.dispatch(transaction), -1)).toBe(
      true,
    );
    expect(tableText(editor).map((row) => row[0])).toEqual(['Name', 'Bia', 'Ana']);
    expect(findTableContext(editor.state)).toMatchObject({ row: 1, column: 1 });
    expect(moveTableRow(editor.state, editor.view.dispatch, -1)).toBe(false);
    expect(moveTableRow(editor.state, editor.view.dispatch, 1)).toBe(true);
    expect(moveTableRow(editor.state, editor.view.dispatch, 1)).toBe(false);

    selectCell(editor, 0, 0);
    expect(moveTableRow(editor.state, editor.view.dispatch, 1)).toBe(false);
  });

  it('moves and aligns complete columns with boundary protection', () => {
    const editor = createEditor(markdown);
    selectCell(editor, 1, 1);

    expect(moveTableColumn(editor.state, undefined, -1)).toBe(true);
    expect(
      moveTableColumn(editor.state, (transaction) => editor.view.dispatch(transaction), -1),
    ).toBe(true);
    expect(tableText(editor)[0]).toEqual(['Score', 'Name', 'Notes']);
    expect(findTableContext(editor.state)).toMatchObject({ row: 1, column: 0 });
    expect(moveTableColumn(editor.state, editor.view.dispatch, -1)).toBe(false);
    expect(moveTableColumn(editor.state, editor.view.dispatch, 1)).toBe(true);

    expect(
      alignTableColumn(editor.state, (transaction) => editor.view.dispatch(transaction), 'right'),
    ).toBe(true);
    const context = findTableContext(editor.state)!;
    for (let row = 0; row < context.height; row += 1) {
      expect(context.table.child(row).child(context.column).attrs.align).toBe('right');
    }
    expect(editor.markdown!.serialize(editor.getJSON())).toMatch(/-+:\s*\|/);
  });

  it('rejects table commands outside tables and unsupported merged columns', () => {
    const editor = createEditor('Plain paragraph');
    expect(findTableContext(editor.state)).toBeNull();
    expect(moveTableRow(editor.state, editor.view.dispatch, 1)).toBe(false);
    expect(moveTableColumn(editor.state, editor.view.dispatch, 1)).toBe(false);
    expect(alignTableColumn(editor.state, editor.view.dispatch, 'center')).toBe(false);
    expect(addTableRowAndFocus(editor)).toBe(false);

    const tableEditor = createEditor(markdown);
    const table = tableEditor.state.doc.firstChild!;
    const firstRow = table.firstChild!;
    const merged = firstRow
      .child(0)
      .type.create({ ...firstRow.child(0).attrs, colspan: 2 }, firstRow.child(0).content);
    const malformedRow = firstRow.type.create(firstRow.attrs, [merged, firstRow.child(2)]);
    const malformed = table.type.create(table.attrs, [
      malformedRow,
      table.child(1),
      table.child(2),
    ]);
    tableEditor.commands.setContent({ type: 'doc', content: [malformed.toJSON()] });
    selectCell(tableEditor, 0, 0);
    expect(moveTableColumn(tableEditor.state, tableEditor.view.dispatch, 1)).toBe(false);
    expect(alignTableColumn(tableEditor.state, tableEditor.view.dispatch, 'left')).toBe(false);
  });

  it('adds rows with Enter semantics and uses spreadsheet Tab navigation', () => {
    const editor = createEditor(markdown);
    selectCell(editor, 1, 1);
    expect(addTableRowAndFocus(editor)).toBe(true);
    expect(findTableContext(editor.state)).toMatchObject({ row: 2, column: 1, height: 4 });

    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(findTableContext(editor.state)).toMatchObject({ row: 3, column: 1, height: 5 });

    const context = findTableContext(editor.state)!;
    selectCell(editor, context.height - 1, context.width - 1);
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(findTableContext(editor.state)).toMatchObject({
      row: context.height,
      column: 0,
      height: context.height + 1,
    });
    const previous = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    editor.view.dom.dispatchEvent(previous);
    expect(previous.defaultPrevented).toBe(true);
  });

  it('inserts a table as one undoable transaction and selects its first cell', () => {
    const onTransaction = vi.fn();
    const editor = createEditor('', onTransaction);
    expect(insertMarkdownTable(editor, 0, 3)).toBe(false);
    expect(insertMarkdownTable(editor, 4, 3)).toBe(true);
    expect(findTableContext(editor.state)).toMatchObject({
      row: 0,
      column: 0,
      width: 3,
      height: 4,
    });
    expect(onTransaction).toHaveBeenCalledTimes(1);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');
  });

  it('activates a static table, operates the toolbar, and synchronizes on outside click', () => {
    const onTransaction = vi.fn();
    const editor = createEditor(markdown, onTransaction);
    const wrapper = document.querySelector<HTMLElement>('.hypermd-table-wrapper')!;
    const table = wrapper.querySelector('table')!;
    selectCell(editor, 1, 0);

    table.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(wrapper).toHaveClass('active');
    expect(wrapper.querySelector('.hypermd-table-current-cell')).not.toBeNull();
    expect(
      wrapper.querySelector<HTMLButtonElement>('[aria-label="Remove row"]'),
    ).not.toBeDisabled();

    table.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    const unrelatedKey = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    wrapper.dispatchEvent(unrelatedKey);
    expect(wrapper).toHaveClass('active');

    wrapper.querySelector<HTMLButtonElement>('[aria-label="Align column center"]')!.click();
    expect(findTableContext(editor.state)!.table.child(0).child(0).attrs.align).toBe('center');
    wrapper.querySelector<HTMLButtonElement>('[aria-label="Add row below"]')!.click();
    expect(findTableContext(editor.state)!.height).toBe(4);

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(wrapper).not.toHaveClass('active');
    expect(
      onTransaction.mock.calls.some(
        ([event]) => event.transaction.getMeta(TABLE_MODE_EXIT) === true,
      ),
    ).toBe(true);
  });

  it('disables destructive header and last-column controls and exits with Escape', () => {
    const editor = createEditor('| Only |\n| --- |\n| Value |');
    const wrapper = document.querySelector<HTMLElement>('.hypermd-table-wrapper')!;
    const table = wrapper.querySelector('table')!;
    selectCell(editor, 0, 0);
    table.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(wrapper.querySelector<HTMLButtonElement>('[aria-label="Remove row"]')).toBeDisabled();
    expect(wrapper.querySelector<HTMLButtonElement>('[aria-label="Move row up"]')).toBeDisabled();
    expect(wrapper.querySelector<HTMLButtonElement>('[aria-label="Remove column"]')).toBeDisabled();
    expect(
      wrapper.querySelector<HTMLButtonElement>('[aria-label="Move column left"]'),
    ).toBeDisabled();
    expect(
      wrapper.querySelector<HTMLButtonElement>('[aria-label="Move column right"]'),
    ).toBeDisabled();

    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    wrapper.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(wrapper).not.toHaveClass('active');
    expect(editor.state.doc.lastChild?.type.name).toBe('paragraph');
    expect(findTableContext(editor.state)).toBeNull();
  });

  it('switches active mode between tables and keeps toolbar actions scoped', () => {
    const editor = createEditor(
      ['| A |', '| --- |', '| 1 |', '', '| B |', '| --- |', '| 2 |'].join('\n'),
    );
    const wrappers = [...document.querySelectorAll<HTMLElement>('.hypermd-table-wrapper')];
    expect(wrappers).toHaveLength(2);

    wrappers[0].querySelector('table')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(wrappers[0]).toHaveClass('active');
    wrappers[1].querySelector('table')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(wrappers[0]).not.toHaveClass('active');
    expect(wrappers[1]).toHaveClass('active');
  });
});
