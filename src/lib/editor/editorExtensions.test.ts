import { Editor, type Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import type { EditorView as CodeMirrorView } from '@codemirror/view';
import { fireEvent, waitFor } from '@testing-library/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodeLanguageSelector } from './codeblock/languageSelector';
import { CodeMirrorBlockView, CodeMirrorCodeBlock, minimalChange } from './extensions/codeBlock';
import { BlockMovement } from './extensions/blockMovement';
import {
  MarkdownImage,
  refreshRenderedImages,
  renderedSource,
  updateElement,
} from './extensions/image';
import { tabsState } from '../tabs/tabStore';
import { sidebarState } from '../sidebar/sidebarStore';
import { tauriMocks } from '../../test/tauriMocks';
import { ListKeyboard } from './extensions/listKeyboard';
import {
  clearFind,
  DocumentFind,
  findRangesInside,
  findText,
  moveFindMatch,
} from './find/findPlugin';

const editors: Editor[] = [];

function editor(content: string, extensions: Extensions = [StarterKit]) {
  const instance = new Editor({
    element: document.createElement('div'),
    extensions,
    content,
  });
  editors.push(instance);
  return instance;
}

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
});

describe('editor extensions', () => {
  it('finds, selects, wraps, updates, and clears document matches', () => {
    const instance = editor('<p>Hello hello</p><p>World</p>', [StarterKit, DocumentFind]);
    const found = findText(instance.view, 'hello');
    expect(found.matches).toHaveLength(2);
    expect(found.activeIndex).toBe(0);
    expect(instance.state.selection.from).toBe(found.matches[0].from);
    expect(moveFindMatch(instance.view, 1).activeIndex).toBe(1);
    expect(moveFindMatch(instance.view, 1).activeIndex).toBe(0);
    expect(findRangesInside(instance.state, 0, instance.state.doc.content.size)).toHaveLength(2);
    instance.commands.setTextSelection(instance.state.doc.content.size - 1);
    instance.commands.insertContent(' hello');
    expect(findRangesInside(instance.state, 0, instance.state.doc.content.size)).toHaveLength(3);
    clearFind(instance.view);
    expect(moveFindMatch(instance.view, 1).matches).toHaveLength(0);
    expect(findText(instance.view, 'missing').activeIndex).toBe(-1);
    expect(findText(instance.view, ' ').matches).toHaveLength(0);
  });

  it('moves top-level blocks while respecting boundaries', () => {
    const instance = editor('<p>One</p><p>Two</p><p>Three</p>', [StarterKit, BlockMovement]);
    instance.commands.setTextSelection(2);
    expect(instance.commands.keyboardShortcut('Alt-ArrowUp')).toBe(true);
    expect(instance.commands.keyboardShortcut('Alt-ArrowDown')).toBe(true);
    expect(instance.getText()).toBe('Two\n\nOne\n\nThree');
    instance.commands.setTextSelection(instance.state.doc.content.size - 1);
    expect(instance.commands.keyboardShortcut('Alt-ArrowDown')).toBe(true);
  });

  it('moves multi-block and node selections in both directions', () => {
    const multi = editor('<p>One</p><p>Two</p><p>Three</p><p>Four</p>', [
      StarterKit,
      BlockMovement,
    ]);
    multi.commands.setTextSelection({ from: 2, to: 10 });
    expect(multi.commands.keyboardShortcut('Alt-ArrowDown')).toBe(true);
    expect(multi.commands.keyboardShortcut('Alt-ArrowUp')).toBe(true);

    const node = editor('<hr><p>After</p>', [StarterKit, BlockMovement]);
    node.commands.setNodeSelection(0);
    expect(node.commands.keyboardShortcut('Alt-ArrowDown')).toBe(true);
    expect(node.getHTML()).toMatch(/<p>After<\/p><hr>/);
  });

  it('handles list Tab shortcuts only inside list items', () => {
    const instance = editor('<ul><li><p>One</p></li><li><p>Two</p></li></ul><p>Outside</p>', [
      StarterKit,
      ListKeyboard,
    ]);
    instance.commands.setTextSelection(9);
    expect(instance.commands.keyboardShortcut('Tab')).toBe(true);
    expect(instance.getHTML()).toContain('<ul>');
    expect(instance.commands.keyboardShortcut('Shift-Tab')).toBe(true);
    const plain = editor('<p>Outside</p>', [StarterKit, ListKeyboard]);
    plain.commands.setTextSelection(2);
    const before = plain.getHTML();
    plain.commands.keyboardShortcut('Tab');
    expect(plain.getHTML()).toBe(before);
  });

  it('renders and refreshes Markdown image node views', async () => {
    const instance = editor('<img src="https://example.com/a.png" alt="A" title="Title">', [
      StarterKit,
      MarkdownImage,
    ]);
    await Promise.resolve();
    await Promise.resolve();
    const image = instance.view.dom.querySelector('img')!;
    expect(image).toHaveAttribute('src', 'https://example.com/a.png');
    expect(image).toHaveAttribute('alt', 'A');
    image.dataset.markdownSrc = 'javascript:bad';
    image.src = 'https://example.com/old.png';
    refreshRenderedImages(instance.view.dom);
    await waitFor(() => expect(image).not.toHaveAttribute('src'));
  });

  it('operates code language selector with search, keyboard, mouse, and cleanup', async () => {
    const onSelect = vi.fn();
    const selector = new CodeLanguageSelector('js', onSelect);
    document.body.append(selector.dom);
    const trigger = selector.dom.querySelector('button')!;
    expect(trigger).toHaveTextContent('JavaScript');
    await fireEvent.click(trigger);
    const input = selector.dom.querySelector('input')!;
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    input.value = 'python';
    await fireEvent.input(input);
    const python = Array.from(selector.dom.querySelectorAll('[role="option"]')).find(
      (option) => option.textContent === 'Python',
    )!;
    await fireEvent.click(python);
    expect(onSelect).toHaveBeenCalled();

    await fireEvent.click(trigger);
    const reopened = selector.dom.querySelector('input')!;
    reopened.value = 'no-such-language';
    await fireEvent.input(reopened);
    expect(selector.dom).toHaveTextContent('No languages found');
    await fireEvent.keyDown(reopened, { key: 'ArrowDown' });
    await fireEvent.keyDown(reopened, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    selector.update(null);
    expect(trigger).toHaveTextContent('Plain Text');
    await fireEvent.click(trigger);
    const keyboardInput = selector.dom.querySelector('input')!;
    keyboardInput.value = 'python';
    await fireEvent.input(keyboardInput);
    await fireEvent.keyDown(keyboardInput, { key: 'ArrowUp' });
    await fireEvent.keyDown(keyboardInput, { key: 'ArrowDown' });
    await fireEvent.keyDown(keyboardInput, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(2);
    await fireEvent.click(trigger);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    selector.destroy();
  });

  it('mounts, updates, selects, and destroys CodeMirror code block views', async () => {
    const instance = editor('<pre><code class="language-js">const value = 1;</code></pre>', [
      StarterKit.configure({ codeBlock: false }),
      CodeMirrorCodeBlock,
      DocumentFind,
    ]);
    await waitFor(() => expect(instance.view.dom.querySelector('.cm-editor')).not.toBeNull());
    expect(instance.view.dom.querySelector('[aria-label="Code block"]')).toHaveTextContent(
      'const value = 1;',
    );
    expect(instance.view.dom.querySelector('.code-language-trigger')).toHaveTextContent(
      'JavaScript',
    );
    instance.commands.setContent('<pre><code class="language-python">print(1)</code></pre>');
    await waitFor(() =>
      expect(instance.view.dom.querySelector('[aria-label="Code block"]')).toHaveTextContent(
        'print(1)',
      ),
    );
    findText(instance.view, 'print');
  });

  it('computes minimal text changes for insertions, deletion, replacement, and equality', () => {
    expect(minimalChange('same', 'same')).toBeNull();
    expect(minimalChange('abc', 'abXc')).toEqual({ from: 2, to: 2, insert: 'X' });
    expect(minimalChange('abXc', 'abc')).toEqual({ from: 2, to: 3, insert: '' });
    expect(minimalChange('prefix-old-suffix', 'prefix-new-suffix')).toEqual({
      from: 7,
      to: 10,
      insert: 'new',
    });
  });

  it('drives CodeMirror block view lifecycle and outer document synchronization', async () => {
    const instance = editor('<pre><code class="language-js">abc</code></pre><p>after</p>', [
      StarterKit.configure({ codeBlock: false }),
      CodeMirrorCodeBlock,
      DocumentFind,
    ]);
    const node = instance.state.doc.firstChild!;
    const block = new CodeMirrorBlockView({
      node,
      view: instance.view,
      getPos: () => 0,
    } as never);
    document.body.append(block.dom);
    expect(block.stopEvent()).toBe(true);
    expect(block.ignoreMutation()).toBe(true);
    block.setSelection(0, 1);

    const internals = block as unknown as {
      codeMirror: CodeMirrorView;
      maybeEscape: (unit: 'line' | 'char', direction: -1 | 1) => boolean;
      exitCodeBlock: () => boolean;
      setLanguage: (language: string | null) => void;
    };
    internals.codeMirror.focus();
    internals.codeMirror.dispatch({ changes: { from: 1, to: 2, insert: 'XYZ' } });
    await waitFor(() => expect(instance.getText()).toContain('aXYZc'));
    expect(internals.maybeEscape('char', -1)).toBe(false);
    internals.codeMirror.dispatch({ selection: { anchor: 0 } });
    expect(internals.maybeEscape('char', -1)).toBe(true);
    internals.codeMirror.dispatch({ selection: { anchor: 0, head: 1 } });
    expect(internals.maybeEscape('line', -1)).toBe(false);
    internals.codeMirror.dispatch({ selection: { anchor: internals.codeMirror.state.doc.length } });
    expect(internals.maybeEscape('char', 1)).toBe(true);
    internals.codeMirror.dispatch({ changes: { from: 0, to: 1, insert: '' } });
    internals.setLanguage('python');
    await waitFor(() => expect(instance.getHTML()).toContain('language-python'));

    const updatedNode = instance.state.doc.firstChild!;
    expect(block.update(updatedNode, [], {} as never)).toBe(true);
    expect(block.update(instance.state.schema.nodes.paragraph.create(), [], {} as never)).toBe(
      false,
    );
    block.destroy();
  });

  it('rejects a code block view whose document position disappeared', () => {
    const instance = editor('<pre><code>x</code></pre>', [
      StarterKit.configure({ codeBlock: false }),
      CodeMirrorCodeBlock,
      DocumentFind,
    ]);
    expect(
      () =>
        new CodeMirrorBlockView({
          node: instance.state.doc.firstChild!,
          view: instance.view,
          getPos: () => undefined,
        } as never),
    ).toThrow('outside the document');
  });

  it('resolves and updates rendered image sources across safety branches', async () => {
    expect(await renderedSource('https://example.com/a.png')).toBe('https://example.com/a.png');
    for (const source of ['', 'data:image/png,a', 'blob:x', 'javascript:x']) {
      expect(await renderedSource(source)).toBe('');
    }
    tabsState.set({ tabs: [], activeId: null, ready: true });
    expect(await renderedSource('./a.png')).toBe('');

    const markdownEditor = editor('<p>Text</p>', [StarterKit, MarkdownImage]);
    sidebarState.set({
      visible: true,
      width: 240,
      activeView: 'explorer',
      workspacePath: '/work',
      workspaceName: 'Work',
    });
    tabsState.set({
      tabs: [
        {
          id: 'markdown',
          path: '/work/note.md',
          name: 'note.md',
          type: 'markdown',
          pinned: false,
          dirty: false,
          missing: false,
          state: markdownEditor.state,
          savedDoc: markdownEditor.state.doc,
        },
      ],
      activeId: 'markdown',
      ready: true,
    });
    expect(await renderedSource('./a.png')).toBe('asset:///work/a.png');
    tabsState.set({
      tabs: [
        {
          id: 'image',
          path: '/work/a.png',
          name: 'a.png',
          type: 'image',
          pinned: false,
          dirty: false,
          missing: false,
        },
      ],
      activeId: 'image',
      ready: true,
    });
    expect(await renderedSource('./a.png')).toBe('');

    const image = document.createElement('img');
    await updateElement(image, 'https://example.com/a.png');
    expect(image).toHaveAttribute('src', 'https://example.com/a.png');
    await updateElement(image, 'javascript:x');
    expect(image).not.toHaveAttribute('src');
  });

  it('updates Markdown image node view attributes and rejects other node types', async () => {
    const instance = editor('<p>Text</p>', [StarterKit, MarkdownImage]);
    const imageNode = instance.schema.nodes.image.create({
      src: 'https://example.com/a.png',
      alt: 'One',
      title: 'Title',
    });
    const renderer = (
      MarkdownImage.config.addNodeView as unknown as () => (props: unknown) => {
        dom: HTMLImageElement;
        update: (node: typeof imageNode) => boolean;
      }
    )();
    const view = renderer({ node: imageNode });
    await Promise.resolve();
    expect(view.dom).toHaveAttribute('title', 'Title');
    const updated = instance.schema.nodes.image.create({
      src: 'https://example.com/b.png',
      alt: 'Two',
      title: null,
    });
    expect(view.update(updated)).toBe(true);
    await Promise.resolve();
    expect(view.dom).toHaveAttribute('alt', 'Two');
    expect(view.dom).not.toHaveAttribute('title');
    expect(view.update(instance.schema.nodes.paragraph.create() as typeof imageNode)).toBe(false);
  });
});
