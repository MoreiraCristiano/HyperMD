import { openUrl } from '@tauri-apps/plugin-opener';

type WebviewGuardOptions = {
  onError?: (message: string) => void;
};

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    Boolean(target.closest('[contenteditable="true"]')) ||
    target.matches('input, textarea, select')
  );
}

function linkFromEvent(event: MouseEvent): HTMLAnchorElement | null {
  const target = event.target;
  return target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null;
}

function hasNavigationPayload(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return dataTransfer.files.length > 0 || dataTransfer.types.includes('text/uri-list');
}

export function setupWebviewGuards(options: WebviewGuardOptions = {}): () => void {
  function keydown(event: KeyboardEvent) {
    const command = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    if (event.key === 'F5' || (command && key === 'r')) {
      event.preventDefault();
      return;
    }

    // Bloqueia apenas o zoom nativo; handlers internos continuam recebendo o evento.
    if (command && (key === '+' || key === '=' || key === '-' || key === '0')) {
      event.preventDefault();
      return;
    }

    if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      return;
    }

    if (event.key === 'Backspace' && !isEditableTarget(event.target)) {
      event.preventDefault();
      return;
    }

    if (
      import.meta.env.PROD &&
      (event.key === 'F12' ||
        (command && event.shiftKey && (key === 'i' || key === 'j' || key === 'c')))
    ) {
      event.preventDefault();
    }
  }

  function contextmenu(event: MouseEvent) {
    event.preventDefault();
  }

  function click(event: MouseEvent) {
    if (event.defaultPrevented) return;
    const link = linkFromEvent(event);
    if (!link) return;
    event.preventDefault();

    const href = link.getAttribute('href');
    if (!href) return;
    let url: URL;
    try {
      url = new URL(href, window.location.href);
    } catch {
      return;
    }
    if (!EXTERNAL_PROTOCOLS.has(url.protocol)) return;
    void openUrl(url.href).catch((cause) => {
      options.onError?.(
        cause instanceof Error ? cause.message : 'Não foi possível abrir o link externo.',
      );
    });
  }

  function dragstart(event: DragEvent) {
    const target = event.target;
    if (target instanceof Element && target.closest('img, a[href]')) event.preventDefault();
  }

  function dragover(event: DragEvent) {
    if (!event.defaultPrevented && hasNavigationPayload(event.dataTransfer)) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
    }
  }

  function drop(event: DragEvent) {
    if (!event.defaultPrevented && hasNavigationPayload(event.dataTransfer)) {
      event.preventDefault();
    }
  }

  window.addEventListener('keydown', keydown, { capture: true });
  window.addEventListener('contextmenu', contextmenu);
  window.addEventListener('click', click);
  window.addEventListener('dragstart', dragstart);
  window.addEventListener('dragover', dragover);
  window.addEventListener('drop', drop);

  return () => {
    window.removeEventListener('keydown', keydown, { capture: true });
    window.removeEventListener('contextmenu', contextmenu);
    window.removeEventListener('click', click);
    window.removeEventListener('dragstart', dragstart);
    window.removeEventListener('dragover', dragover);
    window.removeEventListener('drop', drop);
  };
}
