import Image from '@tiptap/extension-image';
import type { NodeViewRendererProps } from '@tiptap/core';
import { get } from 'svelte/store';
import { markdownImageUrl } from '../../images/localImage';
import { tabsState } from '../../tabs/tabStore';

export async function renderedSource(markdownSrc: string): Promise<string> {
  if (/^https?:\/\//i.test(markdownSrc)) return markdownSrc;
  if (!markdownSrc || /^(?:data|blob|javascript):/i.test(markdownSrc)) return '';

  const tabs = get(tabsState);
  const tab = tabs.tabs.find((candidate) => candidate.id === tabs.activeId);
  if (!tab || tab.type !== 'markdown') return '';
  return markdownImageUrl(markdownSrc, tab.path);
}

export async function updateElement(element: HTMLImageElement, markdownSrc: string): Promise<void> {
  element.dataset.markdownSrc = markdownSrc;
  const source = await renderedSource(markdownSrc).catch(() => '');
  if (element.dataset.markdownSrc !== markdownSrc) return;
  if (source) element.src = source;
  else element.removeAttribute('src');
}

export const MarkdownImage = Image.extend({
  addNodeView() {
    return ({ node }: NodeViewRendererProps) => {
      const element = document.createElement('img');
      element.className = 'markdown-image';
      element.draggable = false;
      element.alt = node.attrs.alt ?? '';
      if (node.attrs.title) element.title = node.attrs.title;
      void updateElement(element, node.attrs.src ?? '');

      return {
        dom: element,
        update(updatedNode) {
          if (updatedNode.type.name !== 'image') return false;
          element.alt = updatedNode.attrs.alt ?? '';
          if (updatedNode.attrs.title) element.title = updatedNode.attrs.title;
          else element.removeAttribute('title');
          void updateElement(element, updatedNode.attrs.src ?? '');
          return true;
        },
      };
    };
  },
}).configure({
  allowBase64: false,
  HTMLAttributes: { class: 'markdown-image' },
});

export function refreshRenderedImages(root: HTMLElement): void {
  for (const image of root.querySelectorAll<HTMLImageElement>('img[data-markdown-src]')) {
    void updateElement(image, image.dataset.markdownSrc ?? '');
  }
}
