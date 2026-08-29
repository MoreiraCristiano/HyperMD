import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tauriMocks } from '@/test/tauriMocks';
import type { EditorApi } from './editorTypes';
import Editor from './Editor.svelte';
import { findTableContext } from './extensions/table';
import { WORKSPACE_IMAGE_DRAG_TYPE } from '@/features/workspace/components/dragTypes';

describe('Editor', () => {
  beforeEach(() => {
    tauriMocks.clipboardReadText.mockResolvedValue('pasted');
    tauriMocks.clipboardWriteText.mockResolvedValue(undefined);
  });

  async function mountEditor(onImagePaste = vi.fn(), onWorkspaceImageDrop = vi.fn()) {
    let api: EditorApi | undefined;
    const onTransaction = vi.fn();
    const view = render(Editor, {
      onReady: (ready) => {
        api = ready;
      },
      onTransaction,
      onImagePaste,
      onWorkspaceImageDrop,
    });
    await waitFor(() => expect(api).toBeDefined());
    return { ...view, api: api!, onTransaction, onImagePaste, onWorkspaceImageDrop };
  }

  it('creates, serializes, restores, focuses, and edits Markdown state', async () => {
    const { api, container, onTransaction } = await mountEditor();
    const state = api.createState('# Hello\n\nWorld', { anchor: 999, head: -10 });
    expect(api.serializeState(state)).toContain('# Hello');
    expect(api.serializeNode(state.doc)).toContain('World');
    api.setState(state);
    expect(container.querySelector('.ProseMirror')).toHaveTextContent('HelloWorld');
    api.focus();
    await api.execute('selectAll');
    await api.execute('copy');
    expect(tauriMocks.clipboardWriteText).toHaveBeenCalled();
    await api.execute('cut');
    expect(onTransaction).toHaveBeenCalled();
    await api.execute('paste');
    expect(container.querySelector('.ProseMirror')).toHaveTextContent('pasted');
    expect(await api.execute('undo')).toBe(true);
    expect(await api.execute('redo')).toBe(true);
  });

  it('preserves selected text when writing a cut to the clipboard fails', async () => {
    const { api } = await mountEditor();
    api.setState(api.createState('Alpha Beta', { anchor: 1, head: 6 }));
    tauriMocks.clipboardWriteText.mockRejectedValueOnce(new Error('clipboard unavailable'));

    await expect(api.execute('cut')).rejects.toThrow('clipboard unavailable');

    expect(api.getState().doc.textContent).toBe('Alpha Beta');
    expect(api.getState().selection).toMatchObject({ from: 1, to: 6 });
  });

  it('offers basic editing commands from the editor context menu', async () => {
    const { api, container } = await mountEditor();
    const editor = container.querySelector('.ProseMirror')!;
    const openMenu = async () => {
      await fireEvent.contextMenu(editor, { clientX: 24, clientY: 32 });
      return screen.findByRole('menu', { name: 'Editor actions' });
    };

    api.setState(api.createState('Alpha Beta', { anchor: 1, head: 6 }));
    await openMenu();
    expect(screen.getByRole('menuitem', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Redo' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Cut' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: 'Copy' })).toBeEnabled();

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy' }));
    await waitFor(() => expect(tauriMocks.clipboardWriteText).toHaveBeenLastCalledWith('Alpha'));
    expect(screen.queryByRole('menu', { name: 'Editor actions' })).not.toBeInTheDocument();

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Cut' }));
    await waitFor(() => expect(api.getState().doc.textContent).toBe(' Beta'));

    await openMenu();
    expect(screen.getByRole('menuitem', { name: 'Undo' })).toBeEnabled();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Undo' }));
    await waitFor(() => expect(api.getState().doc.textContent).toBe('Alpha Beta'));

    await openMenu();
    expect(screen.getByRole('menuitem', { name: 'Redo' })).toBeEnabled();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Redo' }));
    await waitFor(() => expect(api.getState().doc.textContent).toBe(' Beta'));

    api.setState(api.createState('Start ', { anchor: 7, head: 7 }));
    await openMenu();
    expect(screen.getByRole('menuitem', { name: 'Cut' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Copy' })).toBeDisabled();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Paste' }));
    await waitFor(() => expect(api.getState().doc.textContent).toBe('Start pasted'));

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Select All' }));
    expect(api.getState().selection.from).toBe(0);
    expect(api.getState().selection.to).toBe(api.getState().doc.content.size);
  });

  it('leaves CodeMirror code blocks outside the editor context menu', async () => {
    const { api, container } = await mountEditor();
    api.setState(api.createState('```js\nconst x = 1;\n```'));
    const codeMirror = await waitFor(() => {
      const element = container.querySelector('.cm-editor');
      expect(element).not.toBeNull();
      return element!;
    });

    await fireEvent.contextMenu(codeMirror, { clientX: 24, clientY: 32 });
    expect(screen.queryByRole('menu', { name: 'Editor actions' })).not.toBeInTheDocument();
  });

  it('opens find UI, navigates matches, and closes it', async () => {
    const user = userEvent.setup();
    const { api } = await mountEditor();
    api.setState(api.createState('hello world hello'));
    api.openFind();
    const input = await screen.findByRole('textbox', { name: 'Find' });
    await user.type(input, 'hello');
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next result' }));
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Previous result' }));
    await fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('search', { name: 'Find in document' })).not.toBeInTheDocument();
  });

  it('inserts images into current and detached states', async () => {
    const { api, container } = await mountEditor();
    const state = api.createState('Before');
    api.setState(state);
    expect(api.insertImage('https://example.com/a.png', 'A', { anchor: 1, head: 1 })).toBe(true);
    await waitFor(() => expect(container.querySelector('img.markdown-image')).not.toBeNull());
    const detached = api.insertImageIntoState(state, './local.png', 'Local', {
      anchor: 1,
      head: 1,
    });
    expect(detached.doc.childCount).toBeGreaterThan(state.doc.childCount);
  });

  it('inserts a table and enters editing mode in its first header cell', async () => {
    const { api, container } = await mountEditor();
    api.setState(api.createState(''));
    expect(api.canInsertTable()).toBe(true);
    expect(api.insertTable(4, 3)).toBe(true);

    await waitFor(() =>
      expect(container.querySelector('.hypermd-table-wrapper')).toHaveClass('active'),
    );
    expect(findTableContext(api.getState())).toMatchObject({
      row: 0,
      column: 0,
      width: 3,
      height: 4,
    });
    expect(api.canInsertTable()).toBe(false);
    expect(api.getState().doc.firstChild?.firstChild?.firstChild?.type.name).toBe('tableHeader');
  });

  it('handles image clipboard paste and plain Markdown paste', async () => {
    const onImagePaste = vi.fn().mockResolvedValue(undefined);
    const { container } = await mountEditor(onImagePaste);
    const editor = container.querySelector('.ProseMirror')!;
    const blob = new Blob(['x'], { type: 'image/png' });
    const imagePaste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(imagePaste, 'clipboardData', {
      value: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => blob }],
        getData: vi.fn(() => ''),
      },
    });
    editor.dispatchEvent(imagePaste);
    await waitFor(() => expect(onImagePaste).toHaveBeenCalledWith(blob, expect.any(Object)));
    expect(imagePaste.defaultPrevented).toBe(true);

    const textPaste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(textPaste, 'clipboardData', {
      value: { items: [], getData: (type: string) => (type === 'text/plain' ? '# Heading' : '') },
    });
    editor.dispatchEvent(textPaste);
    expect(textPaste.defaultPrevented).toBe(true);
  });

  it('drops workspace images at the pointer position', async () => {
    const onWorkspaceImageDrop = vi.fn().mockResolvedValue(undefined);
    const { api, container } = await mountEditor(vi.fn(), onWorkspaceImageDrop);
    api.setState(api.createState('Alpha Beta'));
    const editor = container.querySelector('.ProseMirror')!;
    const paragraph = editor.querySelector('p')!;
    const text = paragraph.firstChild!;
    const originalCaret = document.caretPositionFromPoint;
    const originalElement = document.elementFromPoint;
    Object.defineProperty(document, 'caretPositionFromPoint', {
      configurable: true,
      value: () => ({ offsetNode: text, offset: 6 }),
    });
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => paragraph,
    });
    const transfer = {
      types: [WORKSPACE_IMAGE_DRAG_TYPE],
      getData: vi.fn(() => '/work/a.png'),
      dropEffect: 'none',
    };

    try {
      const dragOver = new Event('dragover', { bubbles: true, cancelable: true });
      Object.defineProperty(dragOver, 'dataTransfer', { value: transfer });
      paragraph.dispatchEvent(dragOver);
      expect(dragOver.defaultPrevented).toBe(true);
      expect(transfer.dropEffect).toBe('copy');

      const drop = new MouseEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX: 24,
        clientY: 32,
      });
      Object.defineProperty(drop, 'dataTransfer', { value: transfer });
      paragraph.dispatchEvent(drop);
      await waitFor(() =>
        expect(onWorkspaceImageDrop).toHaveBeenCalledWith('/work/a.png', {
          anchor: 7,
          head: 7,
        }),
      );
      expect(drop.defaultPrevented).toBe(true);

      Object.defineProperty(document, 'caretPositionFromPoint', {
        configurable: true,
        value: () => null,
      });
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: () => null,
      });
      const noPosition = new MouseEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX: 24,
        clientY: 32,
      });
      Object.defineProperty(noPosition, 'dataTransfer', { value: transfer });
      paragraph.dispatchEvent(noPosition);
      expect(onWorkspaceImageDrop).toHaveBeenCalledTimes(1);

      const unrelated = new MouseEvent('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(unrelated, 'dataTransfer', {
        value: { types: ['text/plain'], getData: vi.fn(() => 'ignored') },
      });
      paragraph.dispatchEvent(unrelated);
      expect(onWorkspaceImageDrop).toHaveBeenCalledTimes(1);
    } finally {
      if (originalCaret) {
        Object.defineProperty(document, 'caretPositionFromPoint', {
          configurable: true,
          value: originalCaret,
        });
      } else Reflect.deleteProperty(document, 'caretPositionFromPoint');
      if (originalElement) {
        Object.defineProperty(document, 'elementFromPoint', {
          configurable: true,
          value: originalElement,
        });
      } else Reflect.deleteProperty(document, 'elementFromPoint');
    }
  });

  it('ignores workspace image drops inside CodeMirror', async () => {
    const onWorkspaceImageDrop = vi.fn().mockResolvedValue(undefined);
    const { api, container } = await mountEditor(vi.fn(), onWorkspaceImageDrop);
    api.setState(api.createState('```js\nconst x = 1;\n```'));
    const codeMirror = await waitFor(() => {
      const element = container.querySelector('.cm-editor');
      expect(element).not.toBeNull();
      return element!;
    });
    const transfer = {
      types: [WORKSPACE_IMAGE_DRAG_TYPE],
      getData: vi.fn(() => '/work/a.png'),
      dropEffect: 'copy',
    };

    await fireEvent.dragOver(codeMirror, { dataTransfer: transfer });
    expect(transfer.dropEffect).toBe('none');
    await fireEvent.drop(codeMirror, { dataTransfer: transfer });
    expect(onWorkspaceImageDrop).not.toHaveBeenCalled();
  });

  it('opens image focus, zooms, resets, and closes preview', async () => {
    const { api, container } = await mountEditor();
    api.insertImage('https://example.com/a.png', 'Preview', { anchor: 1, head: 1 });
    await waitFor(() => expect(container.querySelector('img.markdown-image')).not.toBeNull());
    const image = container.querySelector('img.markdown-image')! as HTMLImageElement;
    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 100 },
      naturalHeight: { configurable: true, value: 50 },
      currentSrc: { configurable: true, value: 'https://example.com/a.png' },
    });
    await fireEvent.doubleClick(image);
    const dialog = await screen.findByRole('dialog', { name: 'Image preview: Preview' });
    await fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByRole('button', { name: 'Reset zoom to 100%' })).toHaveTextContent('125%');
    await fireEvent.keyDown(dialog, { key: '-', ctrlKey: true });
    await fireEvent.click(screen.getByRole('button', { name: 'Reset zoom to 100%' }));
    await fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
