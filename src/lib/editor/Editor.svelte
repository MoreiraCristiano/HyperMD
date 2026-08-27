<script lang="ts">
  import { onMount } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import TaskList from '@tiptap/extension-task-list';
  import TaskItem from '@tiptap/extension-task-item';
  import { EditorState, TextSelection } from '@tiptap/pm/state';
  import { MarkdownSupport } from './markdown';
  import { DocumentFind, clearFind, findText, moveFindMatch } from './find/findPlugin';
  import { MarkdownImage, refreshRenderedImages } from './extensions/image';
  import { isSupportedImageMime } from './imageImport';
  import { sidebarState } from '../sidebar/sidebarStore';
  import type { EditorApi, EditorCommand, StoredSelection } from './editorTypes';

  type Props = {
    onTransaction?: (state: EditorState, docChanged: boolean) => void;
    onReady?: (api: EditorApi) => void;
    onImagePaste?: (blob: Blob, selection: StoredSelection) => Promise<void>;
  };

  let { onTransaction, onReady, onImagePaste }: Props = $props();
  let element: HTMLDivElement;
  let findInput = $state<HTMLInputElement>();
  let editorInstance: Editor | null = null;
  let findOpen = $state(false);
  let findQuery = $state('');
  let findCount = $state(0);
  let findActive = $state(0);

  function syncFind(state: ReturnType<typeof findText>) {
    findCount = state.matches.length;
    findActive = state.activeIndex + 1;
  }

  function updateFind() {
    if (!editorInstance) return;
    syncFind(findText(editorInstance.view, findQuery));
  }

  function moveFind(direction: number) {
    if (!editorInstance) return;
    syncFind(moveFindMatch(editorInstance.view, direction));
    findInput?.focus();
  }

  function openFind() {
    findOpen = true;
    queueMicrotask(() => {
      findInput?.focus();
      findInput?.select();
    });
  }

  function closeFind(focusEditor = true) {
    findOpen = false;
    findQuery = '';
    findCount = 0;
    findActive = 0;
    if (editorInstance) clearFind(editorInstance.view);
    if (focusEditor) editorInstance?.commands.focus();
  }

  $effect(() => {
    $sidebarState.workspacePath;
    if (element) requestAnimationFrame(() => refreshRenderedImages(element));
  });

  onMount(() => {
    const editor = new Editor({
      element,
      extensions: [
        StarterKit.configure({
          codeBlock: {
            enableTabIndentation: true,
            tabSize: 2,
            HTMLAttributes: { spellcheck: 'false' },
          },
          link: { openOnClick: false, autolink: true, linkOnPaste: true },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        MarkdownImage,
        MarkdownSupport,
        DocumentFind,
      ],
      content: '',
      contentType: 'markdown',
      autofocus: false,
      editorProps: {
        attributes: {
          class: 'hypermd-editor',
          spellcheck: 'true',
          'aria-label': 'Editor Markdown',
        },
        handlePaste(view, event) {
          const item = Array.from(event.clipboardData?.items ?? []).find(
            (candidate) => candidate.kind === 'file' && isSupportedImageMime(candidate.type),
          );
          const blob = item?.getAsFile();
          if (!blob || !onImagePaste) return false;
          event.preventDefault();
          const selection = {
            anchor: view.state.selection.anchor,
            head: view.state.selection.head,
          };
          void onImagePaste(blob, selection);
          return true;
        },
      },
      onTransaction: ({ editor: currentEditor, transaction }) => {
        onTransaction?.(currentEditor.state, transaction.docChanged);
      },
    });
    editorInstance = editor;
    if (!editor.markdown) throw new Error('Extensão Markdown não inicializada.');
    const markdownManager = editor.markdown!;

    function createState(markdown: string, selection?: StoredSelection): EditorState {
      const doc = editor.schema.nodeFromJSON(markdownManager.parse(markdown));
      let state = EditorState.create({ schema: editor.schema, doc, plugins: editor.state.plugins });
      if (selection) {
        const max = state.doc.content.size;
        const anchor = Math.max(0, Math.min(max, selection.anchor));
        const head = Math.max(0, Math.min(max, selection.head));
        state = state.apply(
          state.tr.setSelection(
            TextSelection.between(state.doc.resolve(anchor), state.doc.resolve(head)),
          ),
        );
      }
      return state;
    }

    async function execute(command: EditorCommand): Promise<boolean> {
      if (command === 'undo') return editor.commands.undo();
      if (command === 'redo') return editor.commands.redo();
      if (command === 'selectAll') return editor.chain().focus().selectAll().run();
      if (command === 'paste') {
        const text = await navigator.clipboard.readText();
        const escaped = text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\r?\n/g, '<br>');
        return editor.chain().focus().insertContent(escaped).run();
      }

      const { from, to } = editor.state.selection;
      if (from === to) return false;
      const text = editor.state.doc.textBetween(from, to, '\n');
      await navigator.clipboard.writeText(text);
      if (command === 'cut') return editor.chain().focus().deleteSelection().run();
      return true;
    }

    function transactionWithImage(
      state: EditorState,
      src: string,
      alt: string,
      selection: StoredSelection,
    ) {
      const max = state.doc.content.size;
      const anchor = Math.max(0, Math.min(max, selection.anchor));
      const head = Math.max(0, Math.min(max, selection.head));
      const restoredSelection = TextSelection.between(
        state.doc.resolve(anchor),
        state.doc.resolve(head),
      );
      const image = state.schema.nodes.image.create({ src, alt });
      return state.tr.setSelection(restoredSelection).replaceSelectionWith(image).scrollIntoView();
    }

    const api: EditorApi = {
      createState,
      getState: () => editor.state,
      setState: (state) => {
        findOpen = false;
        findQuery = '';
        findCount = 0;
        findActive = 0;
        editor.view.updateState(state);
        clearFind(editor.view);
        requestAnimationFrame(() => refreshRenderedImages(element));
      },
      serializeState: (state) => markdownManager.serialize(state.doc.toJSON()),
      serializeNode: (node) => markdownManager.serialize(node.toJSON()),
      execute,
      insertImage: (src, alt, selection) => {
        editor.view.dispatch(transactionWithImage(editor.state, src, alt, selection));
        editor.commands.focus();
        return true;
      },
      insertImageIntoState: (state, src, alt, selection) =>
        state.apply(transactionWithImage(state, src, alt, selection)),
      focus: () => editor.commands.focus(),
      openFind,
    };

    onReady?.(api);
    return () => {
      editorInstance = null;
      editor.destroy();
    };
  });
</script>

<div class="editor-container">
  {#if findOpen}
    <div class="editor-find-bar" role="search" aria-label="Pesquisar no documento">
      <input
        bind:this={findInput}
        value={findQuery}
        oninput={(event) => {
          findQuery = event.currentTarget.value;
          updateFind();
        }}
        onkeydown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            closeFind();
          } else if (event.key === 'Enter') {
            event.preventDefault();
            moveFind(event.shiftKey ? -1 : 1);
          }
        }}
        placeholder="Pesquisar"
        aria-label="Pesquisar"
        spellcheck="false"
      />
      <span class="editor-find-count" aria-live="polite">
        {findCount === 0 ? 'No results' : `${findActive} of ${findCount}`}
      </span>
      <button
        onclick={() => moveFind(-1)}
        disabled={findCount === 0}
        title="Anterior (Shift+Enter)"
        aria-label="Resultado anterior"
      >
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 7 3-3 3 3" /></svg>
      </button>
      <button
        onclick={() => moveFind(1)}
        disabled={findCount === 0}
        title="Próximo (Enter)"
        aria-label="Próximo resultado"
      >
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 5 3 3 3-3" /></svg>
      </button>
      <button onclick={() => closeFind()} title="Fechar (Escape)" aria-label="Fechar pesquisa">
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 3 6 6m0-6L3 9" /></svg>
      </button>
    </div>
  {/if}
  <div class="editor-host" bind:this={element}></div>
</div>
