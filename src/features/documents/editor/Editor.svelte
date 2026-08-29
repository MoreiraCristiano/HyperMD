<script lang="ts">
  import { onMount } from 'svelte';
  import { readText, writeText } from '@/platform/tauri/clipboard';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import { EditorState, Selection, TextSelection } from '@tiptap/pm/state';
  import { MarkdownSupport } from './markdown';
  import { DocumentFind, clearFind, findText, moveFindMatch } from './find/findPlugin';
  import { MarkdownImage, refreshRenderedImages } from './extensions/image';
  import {
    canInsertMarkdownTable,
    createMarkdownTableExtensions,
    insertMarkdownTable,
  } from './extensions/table';
  import { CodeMirrorCodeBlock } from './extensions/codeBlock';
  import { ListKeyboard } from './extensions/listKeyboard';
  import {
    BlockListItem,
    BlockOrderedList,
    BlockTaskItem,
    BlockTaskList,
  } from './extensions/listItem';
  import { BlockMovement } from './extensions/blockMovement';
  import { isSupportedImageMime } from './imageImport';
  import { sidebarState, WORKSPACE_IMAGE_DRAG_TYPE } from '@/features/workspace';
  import { SidebarContextMenu, type ContextMenuItem } from '@/features/workspace';
  import type { EditorApi, EditorCommand, StoredSelection } from './editorTypes';

  type Props = {
    onTransaction?: (state: EditorState, docChanged: boolean) => void;
    onReady?: (api: EditorApi) => void;
    onImagePaste?: (blob: Blob, selection: StoredSelection) => Promise<void>;
    onWorkspaceImageDrop?: (path: string, selection: StoredSelection) => Promise<void>;
  };

  let { onTransaction, onReady, onImagePaste, onWorkspaceImageDrop }: Props = $props();
  let element: HTMLDivElement;
  let findInput = $state<HTMLInputElement>();
  let editorInstance: Editor | null = null;
  let findOpen = $state(false);
  let findQuery = $state('');
  let findCount = $state(0);
  let findActive = $state(0);
  let focusedImage = $state<{ src: string; alt: string } | null>(null);
  let imageFocusBackdrop = $state<HTMLDivElement>();
  let imageFocusZoom = $state(1);
  let focusedImageWidth = $state(0);
  let focusedImageHeight = $state(0);
  let contextMenu = $state<{ x: number; y: number } | null>(null);
  const IMAGE_FOCUS_ZOOM_LEVELS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5];
  const contextCommands = new Set<EditorCommand>([
    'undo',
    'redo',
    'cut',
    'copy',
    'paste',
    'selectAll',
  ]);

  function editorContextItems(): readonly ContextMenuItem[] {
    const editor = editorInstance;
    const hasSelection = Boolean(editor && !editor.state.selection.empty);
    return [
      { id: 'undo', label: 'Undo', disabled: !editor?.can().undo() },
      { id: 'redo', label: 'Redo', disabled: !editor?.can().redo() },
      { id: 'cut', label: 'Cut', separatorBefore: true, disabled: !hasSelection },
      { id: 'copy', label: 'Copy', disabled: !hasSelection },
      { id: 'paste', label: 'Paste' },
      { id: 'selectAll', label: 'Select All', separatorBefore: true },
    ];
  }

  function contextPosition(event: MouseEvent): number | null {
    const editor = editorInstance;
    if (!editor) return null;
    try {
      return editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null;
    } catch {
      return null;
    }
  }

  function isWorkspaceImageDrag(event: DragEvent): boolean {
    return Boolean(event.dataTransfer?.types.includes(WORKSPACE_IMAGE_DRAG_TYPE));
  }

  function handleWorkspaceImageDragOver(event: DragEvent) {
    if (!isWorkspaceImageDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect =
        event.target instanceof Element && event.target.closest('.hypermd-code-block')
          ? 'none'
          : 'copy';
    }
  }

  function handleWorkspaceImageDrop(event: DragEvent) {
    if (!isWorkspaceImageDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.target instanceof Element && event.target.closest('.hypermd-code-block')) return;
    const path = event.dataTransfer?.getData(WORKSPACE_IMAGE_DRAG_TYPE) ?? '';
    const position = contextPosition(event);
    if (!path || position === null || !onWorkspaceImageDrop) return;
    void onWorkspaceImageDrop(path, { anchor: position, head: position });
  }

  function openEditorContextMenu(event: MouseEvent) {
    const editor = editorInstance;
    const target = event.target;
    if (
      !editor ||
      !(target instanceof Element) ||
      !target.closest('.ProseMirror') ||
      target.closest('.hypermd-code-block')
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const position = contextPosition(event);
    const { from, to } = editor.state.selection;
    if (position !== null && (position < from || position > to)) {
      editor.view.dispatch(
        editor.state.tr
          .setSelection(Selection.near(editor.state.doc.resolve(position)))
          .scrollIntoView(),
      );
    }
    contextMenu = { x: event.clientX, y: event.clientY };
  }

  async function execute(command: EditorCommand): Promise<boolean> {
    const editor = editorInstance;
    if (!editor) return false;
    if (command === 'undo') return editor.commands.undo();
    if (command === 'redo') return editor.commands.redo();
    if (command === 'selectAll') return editor.chain().focus().selectAll().run();
    if (command === 'paste') {
      const text = await readText();
      if (!text) return false;
      return editor.chain().focus().insertContent(text, { contentType: 'markdown' }).run();
    }

    const { from, to } = editor.state.selection;
    if (from === to) return false;
    const text = editor.state.doc.textBetween(from, to, '\n');
    await writeText(text);
    if (command === 'cut') return editor.chain().focus().deleteSelection().run();
    return true;
  }

  async function executeContextAction(action: string) {
    contextMenu = null;
    if (!contextCommands.has(action as EditorCommand)) return;
    try {
      await execute(action as EditorCommand);
    } finally {
      editorInstance?.commands.focus();
    }
  }

  function openImageFocus(event: MouseEvent) {
    const image =
      event.target instanceof HTMLImageElement && event.target.matches('img.markdown-image')
        ? event.target
        : null;
    if (!image?.complete || image.naturalWidth === 0) return;
    const src = image.currentSrc || image.src;
    if (!src) return;
    event.preventDefault();
    focusedImage = { src, alt: image.alt };
    imageFocusZoom = 1;
    focusedImageWidth = 0;
    focusedImageHeight = 0;
    queueMicrotask(() => imageFocusBackdrop?.focus());
  }

  function closeImageFocus() {
    if (!focusedImage) return;
    focusedImage = null;
    queueMicrotask(() => editorInstance?.commands.focus());
  }

  function handleImageFocusKeydown(event: KeyboardEvent) {
    if (!focusedImage) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeImageFocus();
      return;
    }
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      changeImageFocusZoom(1);
    } else if (event.key === '-') {
      event.preventDefault();
      changeImageFocusZoom(-1);
    } else if (event.key === '0') {
      event.preventDefault();
      resetFocusedImageZoom();
    }
  }

  function changeImageFocusZoom(direction: number) {
    imageFocusZoom =
      direction > 0
        ? (IMAGE_FOCUS_ZOOM_LEVELS.find((level) => level > imageFocusZoom) ?? 5)
        : ([...IMAGE_FOCUS_ZOOM_LEVELS].reverse().find((level) => level < imageFocusZoom) ?? 0.1);
  }

  function resetFocusedImageZoom() {
    imageFocusZoom = 1;
  }

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
    if (element) {
      const root = element;
      requestAnimationFrame(() => refreshRenderedImages(root));
    }
  });

  onMount(() => {
    const editor = new Editor({
      element,
      extensions: [
        StarterKit.configure({
          codeBlock: false,
          listItem: false,
          orderedList: false,
          link: { openOnClick: false, autolink: true, linkOnPaste: true },
        }),
        BlockListItem,
        BlockOrderedList,
        BlockTaskList,
        BlockTaskItem,
        ListKeyboard,
        BlockMovement,
        CodeMirrorCodeBlock,
        MarkdownImage,
        ...createMarkdownTableExtensions(),
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
          'aria-label': 'Markdown editor',
        },
        handlePaste(view, event) {
          if (event.target instanceof Element && event.target.closest('.cm-editor')) return false;
          const clipboard = event.clipboardData;
          const item = Array.from(event.clipboardData?.items ?? []).find(
            (candidate) => candidate.kind === 'file' && isSupportedImageMime(candidate.type),
          );
          const blob = item?.getAsFile();
          if (blob && onImagePaste) {
            event.preventDefault();
            const selection = {
              anchor: view.state.selection.anchor,
              head: view.state.selection.head,
            };
            void onImagePaste(blob, selection);
            return true;
          }

          if (!clipboard || clipboard.getData('text/html').includes('data-pm-slice')) return false;
          const markdown = clipboard.getData('text/plain');
          if (!markdown) return false;
          try {
            const inserted =
              editorInstance?.commands.insertContent(markdown, { contentType: 'markdown' }) ??
              false;
            if (inserted) event.preventDefault();
            return inserted;
          } catch (error) {
            console.warn('Could not parse pasted Markdown.', error);
            return false;
          }
        },
      },
      onTransaction: ({ editor: currentEditor, transaction }) => {
        onTransaction?.(currentEditor.state, transaction.docChanged);
      },
    });
    editorInstance = editor;
    element.addEventListener('dblclick', openImageFocus);
    element.addEventListener('contextmenu', openEditorContextMenu);
    element.addEventListener('dragover', handleWorkspaceImageDragOver, true);
    element.addEventListener('drop', handleWorkspaceImageDrop, true);
    if (!editor.markdown) throw new Error('Markdown extension was not initialized.');
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
        focusedImage = null;
        contextMenu = null;
        findOpen = false;
        findQuery = '';
        findCount = 0;
        findActive = 0;
        editor.view.updateState(state);
        clearFind(editor.view);
        const root = element;
        requestAnimationFrame(() => refreshRenderedImages(root));
      },
      serializeState: (state) => markdownManager.serialize(state.doc.toJSON()),
      serializeNode: (node) => markdownManager.serialize(node.toJSON()),
      execute,
      canInsertTable: () => canInsertMarkdownTable(editor),
      insertTable: (rows, columns) => insertMarkdownTable(editor, rows, columns),
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
      element.removeEventListener('dblclick', openImageFocus);
      element.removeEventListener('contextmenu', openEditorContextMenu);
      element.removeEventListener('dragover', handleWorkspaceImageDragOver, true);
      element.removeEventListener('drop', handleWorkspaceImageDrop, true);
      editorInstance = null;
      editor.destroy();
    };
  });
</script>

<div class="editor-container">
  {#if findOpen}
    <div class="editor-find-bar" role="search" aria-label="Find in document">
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
        placeholder="Find"
        aria-label="Find"
        spellcheck="false"
      />
      <span class="editor-find-count" aria-live="polite">
        {findCount === 0 ? 'No results' : `${findActive} of ${findCount}`}
      </span>
      <button
        onclick={() => moveFind(-1)}
        disabled={findCount === 0}
        title="Previous (Shift+Enter)"
        aria-label="Previous result"
      >
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 7 3-3 3 3" /></svg>
      </button>
      <button
        onclick={() => moveFind(1)}
        disabled={findCount === 0}
        title="Next (Enter)"
        aria-label="Next result"
      >
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 5 3 3 3-3" /></svg>
      </button>
      <button onclick={() => closeFind()} title="Close (Escape)" aria-label="Close find">
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 3 6 6m0-6L3 9" /></svg>
      </button>
    </div>
  {/if}
  <div class="editor-host" bind:this={element}></div>
  {#if contextMenu}
    <SidebarContextMenu
      x={contextMenu.x}
      y={contextMenu.y}
      items={editorContextItems()}
      ariaLabel="Editor actions"
      onSelect={(action) => void executeContextAction(action)}
      onClose={() => (contextMenu = null)}
    />
  {/if}
  {#if focusedImage}
    <div
      bind:this={imageFocusBackdrop}
      class="image-focus-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={focusedImage.alt ? `Image preview: ${focusedImage.alt}` : 'Image preview'}
      tabindex="-1"
      onkeydown={handleImageFocusKeydown}
      onclick={(event) => {
        const target = event.target;
        if (target instanceof HTMLImageElement) return;
        if (target instanceof Element && target.closest('.image-focus-toolbar')) return;
        closeImageFocus();
      }}
    >
      <div class="image-focus-viewport">
        <div class="image-focus-canvas">
          <img
            src={focusedImage.src}
            alt={focusedImage.alt}
            draggable="false"
            style:width={focusedImageWidth ? `${focusedImageWidth * imageFocusZoom}px` : undefined}
            style:height={focusedImageHeight
              ? `${focusedImageHeight * imageFocusZoom}px`
              : undefined}
            onload={(event) => {
              const image = event.currentTarget as HTMLImageElement;
              focusedImageWidth = image.naturalWidth;
              focusedImageHeight = image.naturalHeight;
            }}
          />
        </div>
      </div>
      <div class="image-toolbar image-focus-toolbar">
        <button onclick={() => changeImageFocusZoom(-1)} title="Zoom out" aria-label="Zoom out"
          >−</button
        >
        <button
          class="image-focus-zoom"
          onclick={resetFocusedImageZoom}
          title="Reset zoom to 100%"
          aria-label="Reset zoom to 100%">{Math.round(imageFocusZoom * 100)}%</button
        >
        <button onclick={() => changeImageFocusZoom(1)} title="Zoom in" aria-label="Zoom in"
          >+</button
        >
      </div>
    </div>
  {/if}
</div>
