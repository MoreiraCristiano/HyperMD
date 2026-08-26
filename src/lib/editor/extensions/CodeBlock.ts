import {
  textblockTypeInputRule,
  type MarkdownParseHelpers,
  type MarkdownToken,
  type NodeViewRendererProps,
} from '@tiptap/core';
import CodeBlock, { backtickInputRegex, tildeInputRegex } from '@tiptap/extension-code-block';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { ViewMutationRecord } from '@tiptap/pm/view';
import { CODE_LANGUAGES, canonicalLanguage, languageLabel } from '../codeblock/languages';

function codeBlockView({ node: initialNode, view, getPos }: NodeViewRendererProps) {
  let node = initialNode;
  let open = false;
  let query = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'code-block-node';
  wrapper.spellcheck = false;
  const toolbar = document.createElement('div');
  toolbar.className = 'code-block-toolbar';
  toolbar.contentEditable = 'false';
  const trigger = document.createElement('button');
  trigger.className = 'code-language-trigger';
  trigger.type = 'button';
  trigger.setAttribute('aria-haspopup', 'listbox');
  const menu = document.createElement('div');
  menu.className = 'code-language-menu';
  const search = document.createElement('input');
  search.className = 'code-language-search';
  search.type = 'search';
  search.placeholder = 'Buscar linguagem…';
  search.setAttribute('aria-label', 'Buscar linguagem');
  const options = document.createElement('div');
  options.className = 'code-language-options';
  options.setAttribute('role', 'listbox');
  const pre = document.createElement('pre');
  pre.spellcheck = false;
  const content = document.createElement('code');
  content.spellcheck = false;
  content.setAttribute('spellcheck', 'false');
  content.setAttribute('autocorrect', 'off');
  content.setAttribute('autocapitalize', 'off');
  pre.append(content);
  menu.append(search, options);
  toolbar.append(trigger, menu);
  wrapper.append(toolbar, pre);

  function currentLanguage(): string | null {
    return canonicalLanguage(node.attrs.language);
  }

  function close() {
    if (!open) return;
    open = false;
    query = '';
    search.value = '';
    menu.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outsidePointerDown, true);
  }

  function setLanguage(language: string) {
    const pos = getPos();
    if (typeof pos !== 'number') return;
    view.dispatch(
      view.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        language: language || null,
      }),
    );
    close();
    view.focus();
  }

  function renderOptions() {
    const needle = query.trim().toLocaleLowerCase();
    const current = currentLanguage();
    options.replaceChildren();
    const filtered = CODE_LANGUAGES.filter(
      (language) =>
        !needle ||
        language.label.toLocaleLowerCase().includes(needle) ||
        language.value.includes(needle),
    );
    for (const language of filtered) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'code-language-option';
      option.textContent = language.label;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String((current ?? '') === language.value));
      if ((current ?? '') === language.value) option.classList.add('active');
      option.addEventListener('mousedown', (event) => event.preventDefault());
      option.addEventListener('click', () => setLanguage(language.value));
      options.append(option);
    }
    if (filtered.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'code-language-empty';
      empty.textContent = 'Nenhuma linguagem';
      options.append(empty);
    }
  }

  function renderLabel() {
    const language = currentLanguage();
    trigger.textContent = languageLabel(language);
    wrapper.dataset.language = language ?? '';
  }

  function outsidePointerDown(event: PointerEvent) {
    if (!wrapper.contains(event.target as globalThis.Node)) close();
  }

  function toggle(event: MouseEvent) {
    event.preventDefault();
    if (open) {
      close();
      return;
    }
    open = true;
    menu.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    renderOptions();
    document.addEventListener('pointerdown', outsidePointerDown, true);
    queueMicrotask(() => search.focus());
  }

  trigger.addEventListener('mousedown', (event) => event.preventDefault());
  trigger.addEventListener('click', toggle);
  search.addEventListener('input', () => {
    query = search.value;
    renderOptions();
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      view.focus();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      options.querySelector<HTMLButtonElement>('button')?.focus();
    }
  });
  options.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      view.focus();
    }
  });
  renderLabel();

  return {
    dom: wrapper,
    contentDOM: content,
    update(updatedNode: ProseMirrorNode) {
      if (updatedNode.type.name !== 'codeBlock') return false;
      node = updatedNode;
      renderLabel();
      if (open) renderOptions();
      return true;
    },
    stopEvent(event: Event) {
      return toolbar.contains(event.target as globalThis.Node);
    },
    ignoreMutation(mutation: ViewMutationRecord) {
      return toolbar.contains(mutation.target);
    },
    destroy() {
      close();
    },
  };
}

export const CodeBlockWithLanguage = CodeBlock.extend({
  parseMarkdown(token: MarkdownToken, helpers: MarkdownParseHelpers) {
    if (
      token.raw?.startsWith('```') === false &&
      token.raw?.startsWith('~~~') === false &&
      token.codeBlockStyle !== 'indented'
    ) {
      return [];
    }
    return helpers.createNode(
      'codeBlock',
      { language: canonicalLanguage(token.lang) },
      token.text ? [helpers.createTextNode(token.text)] : [],
    );
  },

  addInputRules() {
    const attributes = (match: RegExpMatchArray) => ({
      language: canonicalLanguage(match[1]),
    });
    return [
      textblockTypeInputRule({
        find: backtickInputRegex,
        type: this.type,
        getAttributes: attributes,
      }),
      textblockTypeInputRule({ find: tildeInputRegex, type: this.type, getAttributes: attributes }),
    ];
  },

  addNodeView() {
    return codeBlockView;
  },
}).configure({
  enableTabIndentation: true,
  tabSize: 2,
  HTMLAttributes: { spellcheck: 'false' },
});
