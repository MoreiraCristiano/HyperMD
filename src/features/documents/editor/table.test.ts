import { readFileSync } from 'node:fs';
import { Editor } from '@tiptap/core';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import StarterKit from '@tiptap/starter-kit';
import { AllSelection, TextSelection } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
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
import { ListKeyboard } from './extensions/listKeyboard';

const editors: Editor[] = [];

function createEditor(content: string, onTransaction = vi.fn()): Editor {
  const element = document.body.appendChild(document.createElement('div'));
  const editor = new Editor({
    element,
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      ListKeyboard,
      ...createMarkdownTableExtensions(),
      MarkdownSupport,
    ],
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

function selectTextEnd(editor: Editor, text: string): void {
  let position: number | undefined;
  editor.state.doc.descendants((node, nodePosition) => {
    if (node.isText && node.text === text) position = nodePosition + node.nodeSize;
  });
  if (position === undefined) throw new Error(`Text not found: ${text}`);
  editor.commands.setTextSelection(position);
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
  document.querySelector('[data-table-test-styles]')?.remove();
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
    expect(serialized).not.toContain('hypermd-table-header-align');
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

  it('preserves an explicitly unaligned header over an aligned body', () => {
    const editor = createEditor(
      '<!-- hypermd-table-header-align: [null] -->\n| Header |\n| ---: |\n| Value |',
    );
    const table = editor.state.doc.firstChild!;
    expect(table.child(0).child(0).attrs.align).toBeNull();
    expect(table.child(1).child(0).attrs.align).toBe('right');
    expect(editor.markdown!.serialize(editor.getJSON())).toContain(
      '<!-- hypermd-table-header-align: [null] -->',
    );
  });

  it('creates a body cell with body alignment when adding below a header-only table', () => {
    const headerOnly = '<!-- hypermd-table-header-align: ["center"] -->\n| Header |\n| --- |';
    const editor = createEditor(headerOnly);
    selectCell(editor, 0, 0);
    expect(addTableRowAndFocus(editor)).toBe(true);
    const table = editor.state.doc.firstChild!;
    expect(table.child(1).child(0).type.name).toBe('tableCell');
    expect(table.child(1).child(0).attrs.align).toBeNull();

    const tabEditor = createEditor(headerOnly);
    selectCell(tabEditor, 0, 0);
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    tabEditor.view.dom.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(tabEditor.state.doc.firstChild!.child(1).child(0).type.name).toBe('tableCell');
    expect(tabEditor.state.doc.firstChild!.child(1).child(0).attrs.align).toBeNull();
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

  it('moves columns and aligns header and body independently', () => {
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
      alignTableColumn(
        editor.state,
        (transaction) => editor.view.dispatch(transaction),
        'body',
        'right',
      ),
    ).toBe(true);
    const context = findTableContext(editor.state)!;
    expect(context.table.child(0).child(context.column).attrs.align).toBe('center');
    for (let row = 1; row < context.height; row += 1) {
      expect(context.table.child(row).child(context.column).attrs.align).toBe('right');
    }
    const serialized = editor.markdown!.serialize(editor.getJSON());
    expect(serialized).toContain('<!-- hypermd-table-header-align:');
    expect(serialized).toMatch(/-+:\s*\|/);

    const restored = createEditor(serialized);
    selectCell(restored, 1, context.column);
    const restoredContext = findTableContext(restored.state)!;
    expect(restoredContext.table.child(0).child(context.column).attrs.align).toBe('center');
    expect(restoredContext.table.child(1).child(context.column).attrs.align).toBe('right');
  });

  it('rejects table commands outside tables and unsupported merged columns', () => {
    const editor = createEditor('Plain paragraph');
    expect(findTableContext(editor.state)).toBeNull();
    expect(moveTableRow(editor.state, editor.view.dispatch, 1)).toBe(false);
    expect(moveTableColumn(editor.state, editor.view.dispatch, 1)).toBe(false);
    expect(alignTableColumn(editor.state, editor.view.dispatch, 'body', 'center')).toBe(false);
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
    expect(alignTableColumn(tableEditor.state, tableEditor.view.dispatch, 'body', 'left')).toBe(
      false,
    );
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

    selectCell(editor, 0, 0);
    const previousFromFirst = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    editor.view.dom.dispatchEvent(previousFromFirst);
    expect(previousFromFirst.defaultPrevented).toBe(true);
    expect(findTableContext(editor.state)).toMatchObject({ row: 0, column: 0 });
  });

  it('uses Shift+Tab to lift nested list items before navigating table cells', () => {
    const editor = createEditor(
      ['| Items | Other |', '| --- | --- |', '| - one<br>- two | Keep |'].join('\n'),
    );
    let secondItemTextEnd = -1;
    editor.state.doc.descendants((node, position) => {
      if (node.isText && node.text === 'two') secondItemTextEnd = position + node.nodeSize;
    });
    expect(secondItemTextEnd).toBeGreaterThan(0);
    editor.commands.setTextSelection(secondItemTextEnd);

    const indent = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    editor.view.dom.dispatchEvent(indent);
    const nestedList = editor.state.doc.firstChild?.child(1).child(0).firstChild;
    expect(indent.defaultPrevented).toBe(true);
    expect(nestedList?.type.name).toBe('bulletList');
    expect(nestedList?.firstChild?.lastChild?.type.name).toBe('bulletList');
    expect(findTableContext(editor.state)).toMatchObject({ row: 1, column: 0 });

    const lift = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    editor.view.dom.dispatchEvent(lift);
    const liftedList = editor.state.doc.firstChild?.child(1).child(0).firstChild;
    expect(lift.defaultPrevented).toBe(true);
    expect(liftedList?.childCount).toBe(2);
    expect(liftedList?.child(1).textContent).toBe('two');
    expect(findTableContext(editor.state)).toMatchObject({ row: 1, column: 0 });

    const beforeRootLift = editor.getJSON();
    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(editor.getJSON()).toEqual(beforeRootLift);
    expect(findTableContext(editor.state)).toMatchObject({ row: 1, column: 0 });
  });

  it('places a caret without replacing nested lists when navigating cells', () => {
    const backward = createEditor(
      ['| Items | Other |', '| --- | --- |', '| - one<br>- two | Keep |'].join('\n'),
    );
    selectTextEnd(backward, 'two');
    backward.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    selectCell(backward, 1, 1);

    const shiftTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    backward.view.dom.dispatchEvent(shiftTab);

    expect(shiftTab.defaultPrevented).toBe(true);
    expect(backward.state.selection).toBeInstanceOf(TextSelection);
    expect(backward.state.selection.empty).toBe(true);
    expect(backward.state.selection.$from.parent.textContent).toBe('two');
    expect(backward.state.selection.$from.parentOffset).toBe(3);
    backward.commands.insertContent('!');
    const backwardList = backward.state.doc.firstChild?.child(1).child(0).firstChild;
    expect(backwardList?.firstChild?.lastChild?.type.name).toBe('bulletList');
    expect(backwardList?.firstChild?.lastChild?.textContent).toBe('two!');

    const forward = createEditor(
      ['| Other | Items |', '| --- | --- |', '| Keep | - one<br>- two |'].join('\n'),
    );
    selectTextEnd(forward, 'two');
    forward.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    selectCell(forward, 1, 0);

    const tab = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    forward.view.dom.dispatchEvent(tab);

    expect(tab.defaultPrevented).toBe(true);
    expect(forward.state.selection).toBeInstanceOf(TextSelection);
    expect(forward.state.selection.empty).toBe(true);
    expect(forward.state.selection.$from.parent.textContent).toBe('one');
    expect(forward.state.selection.$from.parentOffset).toBe(0);
    forward.commands.insertContent('!');
    const forwardList = forward.state.doc.firstChild?.child(1).child(1).firstChild;
    expect(forwardList?.firstChild?.firstChild?.textContent).toBe('!one');
    expect(forwardList?.firstChild?.lastChild?.type.name).toBe('bulletList');
    expect(forwardList?.firstChild?.lastChild?.textContent).toBe('two');
  });

  it('moves to the next cell when a list item cannot be nested with Tab', () => {
    const editor = createEditor(
      ['| Items | Other |', '| --- | --- |', '| - one | Keep |'].join('\n'),
    );
    selectTextEnd(editor, 'one');
    const before = editor.getJSON();
    const tab = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });

    editor.view.dom.dispatchEvent(tab);

    expect(tab.defaultPrevented).toBe(true);
    expect(editor.getJSON()).toEqual(before);
    expect(findTableContext(editor.state)).toMatchObject({ row: 1, column: 1, height: 2 });
  });

  it('adds a row when an unnestable list item Tabs from the last cell', () => {
    const editor = createEditor(
      ['| Other | Items |', '| --- | --- |', '| Keep | - one |'].join('\n'),
    );
    selectTextEnd(editor, 'one');
    const tab = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });

    editor.view.dom.dispatchEvent(tab);

    expect(tab.defaultPrevented).toBe(true);
    expect(findTableContext(editor.state)).toMatchObject({ row: 2, column: 0, height: 3 });
    expect(tableText(editor)[1]).toEqual(['Keep', 'one']);
  });

  it('keeps Mod+A selection inside the current table cell', () => {
    const listEditor = createEditor(
      ['| Items | Other |', '| --- | --- |', '| - one<br>- two | Keep |'].join('\n'),
    );
    selectCell(listEditor, 1, 0);
    const table = listEditor.state.doc.firstChild!;
    const relativeCellPos = TableMap.get(table).positionAt(1, 0, table);
    const cellPos = 1 + relativeCellPos;
    const cell = table.child(1).child(0);
    const selectCellContent = () => {
      const event = new KeyboardEvent('keydown', {
        key: 'a',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      listEditor.view.dom.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    };

    selectCellContent();
    expect(listEditor.state.selection).toBeInstanceOf(TextSelection);
    expect(listEditor.state.selection.from).toBeGreaterThan(cellPos);
    expect(listEditor.state.selection.to).toBeLessThan(cellPos + cell.nodeSize);
    expect(
      listEditor.state.doc.textBetween(
        listEditor.state.selection.from,
        listEditor.state.selection.to,
        '\n',
      ),
    ).toBe('one\ntwo');
    const firstSelection = listEditor.state.selection.toJSON();
    selectCellContent();
    expect(listEditor.state.selection.toJSON()).toEqual(firstSelection);

    selectCell(listEditor, 0, 0);
    selectCellContent();
    expect(
      listEditor.state.doc.textBetween(
        listEditor.state.selection.from,
        listEditor.state.selection.to,
        '\n',
      ),
    ).toBe('Items');

    const replaceEditor = createEditor(markdown);
    selectCell(replaceEditor, 1, 0);
    replaceEditor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'a',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    replaceEditor.commands.insertContent('Changed');
    expect(replaceEditor.state.doc.firstChild?.type.name).toBe('table');
    expect(tableText(replaceEditor)[1]).toEqual(['Changed', '10', 'A | B']);

    const outsideEditor = createEditor(`Outside\n\n${markdown}`);
    outsideEditor.commands.setTextSelection(1);
    outsideEditor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'a',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(outsideEditor.state.selection).toBeInstanceOf(AllSelection);
  });

  it('decorates structural cell selections without affecting text selections', () => {
    const editor = createEditor(markdown);
    const table = editor.state.doc.firstChild!;
    const map = TableMap.get(table);
    const firstCell = 1 + map.positionAt(1, 0, table);
    const lastCell = 1 + map.positionAt(1, 2, table);

    editor.view.dispatch(
      editor.state.tr.setSelection(
        new CellSelection(editor.state.doc.resolve(firstCell), editor.state.doc.resolve(lastCell)),
      ),
    );
    expect(editor.state.selection).toBeInstanceOf(CellSelection);
    expect(document.querySelectorAll('.hypermd-table td.selectedCell')).toHaveLength(3);
    expect(document.querySelectorAll('.hypermd-table th.selectedCell')).toHaveLength(0);

    selectCell(editor, 1, 0);
    expect(editor.state.selection).toBeInstanceOf(TextSelection);
    expect(document.querySelectorAll('.hypermd-table .selectedCell')).toHaveLength(0);
  });

  it('places the caret in a clicked cell and confines pointer text selection to it', () => {
    const editor = createEditor(markdown);
    const table = editor.state.doc.firstChild!;
    const map = TableMap.get(table);
    const cellPos = 1 + map.positionAt(1, 0, table);
    const nextCellPos = 1 + map.positionAt(1, 1, table);
    const textFrom = cellPos + 2;
    const textTo = textFrom + table.child(1).child(0).textContent.length;
    const nextCellText = nextCellPos + 2;
    const cell = document.querySelectorAll<HTMLTableCellElement>('.hypermd-table td')[0];
    const wrapper = cell.closest('.hypermd-table-wrapper')!;
    const posAtCoords = vi.spyOn(editor.view, 'posAtCoords');
    const pointer = (type: string, pointerId: number) =>
      new PointerEvent(type, {
        pointerId,
        button: 0,
        clientX: 10,
        clientY: 10,
        bubbles: true,
        cancelable: true,
      });

    posAtCoords.mockReturnValue({ pos: textFrom + 1, inside: cellPos });
    const clickDown = pointer('pointerdown', 1);
    cell.dispatchEvent(clickDown);
    document.dispatchEvent(pointer('pointerup', 1));

    expect(clickDown.defaultPrevented).toBe(true);
    expect(editor.state.selection).toBeInstanceOf(TextSelection);
    expect(editor.state.selection).not.toBeInstanceOf(CellSelection);
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.anchor).toBe(textFrom + 1);
    expect(wrapper).toHaveClass('active');
    expect(cell).toHaveClass('hypermd-table-current-cell');

    posAtCoords.mockReturnValueOnce({ pos: textFrom, inside: cellPos });
    cell.dispatchEvent(pointer('pointerdown', 2));
    posAtCoords.mockReturnValue({ pos: textTo, inside: cellPos });
    document.dispatchEvent(pointer('pointermove', 2));
    document.dispatchEvent(pointer('pointerup', 2));

    expect(editor.state.selection).toBeInstanceOf(TextSelection);
    expect(editor.state.selection.from).toBe(textFrom);
    expect(editor.state.selection.to).toBe(textTo);
    expect(
      editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to),
    ).toBe('Ana');
    expect(document.querySelectorAll('.hypermd-table .selectedCell')).toHaveLength(0);

    posAtCoords.mockReturnValueOnce({ pos: textFrom, inside: cellPos });
    cell.dispatchEvent(pointer('pointerdown', 3));
    posAtCoords.mockReturnValue({ pos: nextCellText, inside: nextCellPos });
    document.dispatchEvent(pointer('pointermove', 3));
    document.dispatchEvent(pointer('pointerup', 3));

    expect(editor.state.selection.from).toBe(textFrom);
    expect(editor.state.selection.to).toBe(textTo);
    expect(
      editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to),
    ).toBe('Ana');
  });

  it.each([
    ['bulletList', () => ({ command: 'toggleBulletList' as const, item: 'listItem' })],
    ['taskList', () => ({ command: 'toggleTaskList' as const, item: 'taskItem' })],
  ])('uses Enter to split a %s inside a cell', (_listType, setup) => {
    const editor = createEditor(markdown);
    selectCell(editor, 1, 0);
    const { command, item } = setup();
    expect(editor.chain().focus()[command]().insertContent('First').run()).toBe(true);
    const height = findTableContext(editor.state)!.height;

    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(enter);

    const context = findTableContext(editor.state)!;
    const list = context.table.child(context.row).child(context.column).firstChild!;
    expect(enter.defaultPrevented).toBe(true);
    expect(context.height).toBe(height);
    expect(list.type.name).toBe(_listType);
    expect(list.childCount).toBe(2);
    expect(list.child(1).type.name).toBe(item);
    if (item === 'taskItem') expect(list.child(1).attrs.checked).toBe(false);
  });

  it('round-trips flat lists and inline formatting inside table cells', () => {
    const source = [
      '| Bullets | Ordered | Tasks |',
      '| --- | --- | --- |',
      '| - **one**<br>- two | 3. three<br>4. four | - [x] done<br>- [ ] pending |',
    ].join('\n');
    const editor = createEditor(source);
    const row = editor.state.doc.firstChild!.child(1);

    expect(row.child(0).firstChild?.type.name).toBe('bulletList');
    expect(row.child(0).firstChild?.childCount).toBe(2);
    expect(row.child(0).firstChild?.firstChild?.firstChild?.firstChild?.marks[0]?.type.name).toBe(
      'bold',
    );
    expect(row.child(1).firstChild?.type.name).toBe('orderedList');
    expect(row.child(1).firstChild?.attrs.start).toBe(3);
    expect(row.child(2).firstChild?.type.name).toBe('taskList');
    expect(row.child(2).firstChild?.child(0).attrs.checked).toBe(true);
    expect(row.child(2).firstChild?.child(1).attrs.checked).toBe(false);

    const restored = createEditor(editor.markdown!.serialize(editor.getJSON()));
    const restoredRow = restored.state.doc.firstChild!.child(1);
    expect(restoredRow.child(0).firstChild?.type.name).toBe('bulletList');
    expect(restoredRow.child(0).firstChild?.childCount).toBe(2);
    expect(restoredRow.child(1).firstChild?.type.name).toBe('orderedList');
    expect(restoredRow.child(1).firstChild?.attrs.start).toBe(3);
    expect(restoredRow.child(2).firstChild?.type.name).toBe('taskList');
    expect(restoredRow.child(2).firstChild?.childCount).toBe(2);
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
    const styles = readFileSync('src/styles/editor.css', 'utf8');
    const toolbarRule = styles.match(/\.hypermd-table-toolbar\s*\{[^}]*\}/)?.[0];
    const activeToolbarRule = styles.match(
      /\.hypermd-table-wrapper\.active \.hypermd-table-toolbar\[data-has-cell\]\s*\{[^}]*\}/,
    )?.[0];
    expect(toolbarRule).toBeDefined();
    expect(activeToolbarRule).toBeDefined();
    const stylesheet = document.head.appendChild(document.createElement('style'));
    stylesheet.dataset.tableTestStyles = '';
    stylesheet.textContent = `${toolbarRule}\n${activeToolbarRule}`;
    const onTransaction = vi.fn();
    const editor = createEditor(markdown, onTransaction);
    const wrapper = document.querySelector<HTMLElement>('.hypermd-table-wrapper')!;
    const table = wrapper.querySelector('table')!;
    const toolbar = wrapper.querySelector<HTMLElement>('.hypermd-table-toolbar')!;
    selectCell(editor, 1, 0);

    expect(getComputedStyle(toolbar).display).toBe('none');
    table.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(wrapper).not.toHaveClass('active');
    table.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(wrapper).toHaveClass('active');
    expect(getComputedStyle(toolbar)).toMatchObject({
      display: 'flex',
      position: 'absolute',
    });
    expect(wrapper.querySelector('.hypermd-table-current-cell')).not.toBeNull();
    expect(
      wrapper.querySelector<HTMLButtonElement>('[aria-label="Remove row"]'),
    ).not.toBeDisabled();

    table.dispatchEvent(new Event('pointerup', { bubbles: true }));
    const unrelatedKey = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    wrapper.dispatchEvent(unrelatedKey);
    expect(wrapper).toHaveClass('active');

    wrapper.querySelector<HTMLButtonElement>('[aria-label="Align header center"]')!.click();
    expect(findTableContext(editor.state)!.table.child(0).child(0).attrs.align).toBe('center');
    expect(findTableContext(editor.state)!.table.child(1).child(0).attrs.align).toBe('left');
    wrapper.querySelector<HTMLButtonElement>('[aria-label="Align body right"]')!.click();
    expect(findTableContext(editor.state)!.table.child(1).child(0).attrs.align).toBe('right');
    wrapper.querySelector<HTMLButtonElement>('[aria-label="Add row below"]')!.click();
    expect(findTableContext(editor.state)!.height).toBe(4);
    expect(findTableContext(editor.state)!.table.child(2).child(0).attrs.align).toBe('right');

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(wrapper).not.toHaveClass('active');
    expect(
      onTransaction.mock.calls.some(
        ([event]) => event.transaction.getMeta(TABLE_MODE_EXIT) === true,
      ),
    ).toBe(true);
  });

  it('constrains table width and wraps cell content even when global word wrap is off', () => {
    const styles = readFileSync('src/styles/editor.css', 'utf8');
    const patterns = [
      /\.hypermd-table-viewport\s*\{[^}]*\}/,
      /\.hypermd-table\s*\{[^}]*\}/,
      /\.hypermd-table th,\s*\.hypermd-table td\s*\{[^}]*\}/,
      /:root\[data-editor-word-wrap='off'\] \.hypermd-editor p,[\s\S]*?\{\s*white-space: nowrap;\s*\}/,
      /:root\[data-editor-word-wrap='off'\]\s+\.hypermd-editor\s+\.hypermd-table\s+:is\([^)]*\)\s*\{[^}]*\}/,
    ];
    const rules = patterns.map((pattern) => styles.match(pattern)?.[0]);
    expect(rules).not.toContain(undefined);
    const stylesheet = document.head.appendChild(document.createElement('style'));
    stylesheet.dataset.tableTestStyles = '';
    stylesheet.textContent = rules.join('\n');
    document.documentElement.dataset.editorWordWrap = 'off';
    const editor = createEditor(
      ['| Items | Other |', '| --- | --- |', '| - one | Keep |'].join('\n'),
    );
    editor.view.dom.classList.add('hypermd-editor');

    const viewport = document.querySelector<HTMLElement>('.hypermd-table-viewport')!;
    const table = viewport.querySelector<HTMLTableElement>('.hypermd-table')!;
    const cell = table.querySelector<HTMLTableCellElement>('td')!;
    const item = cell.querySelector<HTMLLIElement>('li')!;

    expect(getComputedStyle(viewport)).toMatchObject({
      boxSizing: 'border-box',
      overflowX: 'auto',
      width: '100%',
    });
    expect(getComputedStyle(table)).toMatchObject({ tableLayout: 'fixed', width: '100%' });
    expect(getComputedStyle(cell)).toMatchObject({
      minWidth: '90px',
      overflowWrap: 'anywhere',
      whiteSpace: 'normal',
    });
    expect(getComputedStyle(item).whiteSpace).toBe('normal');
  });

  it('blocks drag-and-drop initiated from table cells without changing the document', () => {
    const onTransaction = vi.fn();
    const editor = createEditor(markdown, onTransaction);
    const table = document.querySelector<HTMLTableElement>('.hypermd-table')!;
    const header = table.querySelector('th')!;
    const cell = table.querySelector('td')!;
    const documentDrag = vi.fn();
    document.addEventListener('dragstart', documentDrag);
    const before = editor.state.doc;

    for (const target of [header, cell]) {
      const drag = new Event('dragstart', { bubbles: true, cancelable: true });
      target.dispatchEvent(drag);
      expect(drag.defaultPrevented).toBe(true);
    }

    expect(documentDrag).not.toHaveBeenCalled();
    expect(editor.state.doc.eq(before)).toBe(true);
    expect(onTransaction).not.toHaveBeenCalled();
    document.removeEventListener('dragstart', documentDrag);
  });

  it('disables destructive header and last-column controls and exits with Escape', () => {
    const editor = createEditor('| Only |\n| --- |');
    const wrapper = document.querySelector<HTMLElement>('.hypermd-table-wrapper')!;
    const table = wrapper.querySelector('table')!;
    selectCell(editor, 0, 0);
    table.dispatchEvent(new Event('pointerup', { bubbles: true }));

    expect(wrapper.querySelector<HTMLButtonElement>('[aria-label="Remove row"]')).toBeDisabled();
    expect(wrapper.querySelector<HTMLButtonElement>('[aria-label="Move row up"]')).toBeDisabled();
    expect(wrapper.querySelector<HTMLButtonElement>('[aria-label="Remove column"]')).toBeDisabled();
    expect(
      wrapper.querySelector<HTMLButtonElement>('[aria-label="Align body left"]'),
    ).toBeDisabled();
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

    wrappers[0].querySelector('table')!.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(wrappers[0]).toHaveClass('active');
    wrappers[1].querySelector('table')!.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(wrappers[0]).not.toHaveClass('active');
    expect(wrappers[1]).toHaveClass('active');
  });
});
