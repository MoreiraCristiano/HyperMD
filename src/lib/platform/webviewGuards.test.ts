import { describe, expect, it, vi } from 'vitest';
import { tauriMocks } from '../../test/tauriMocks';
import { setupWebviewGuards } from './webviewGuards';

describe('webview guards', () => {
  it('blocks native navigation shortcuts but permits editable backspace', () => {
    const dispose = setupWebviewGuards();
    for (const init of [
      { key: 'F5' },
      { key: 'r', ctrlKey: true },
      { key: 'p', ctrlKey: true },
      { key: '+', ctrlKey: true },
      { key: 'ArrowLeft', altKey: true },
      { key: 'Backspace' },
    ]) {
      const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    const input = document.createElement('input');
    document.body.append(input);
    const editable = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(editable);
    expect(editable.defaultPrevented).toBe(false);
    dispose();
  });

  it('opens only external links and reports opener failures', async () => {
    const onError = vi.fn();
    const dispose = setupWebviewGuards({ onError });
    const link = document.createElement('a');
    link.href = 'https://example.com/path';
    document.body.append(link);
    link.click();
    expect(tauriMocks.openUrl).toHaveBeenCalledWith('https://example.com/path');

    tauriMocks.openUrl.mockRejectedValueOnce(new Error('blocked'));
    link.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith('blocked');

    const internal = document.createElement('a');
    internal.href = 'file:///work/a.md';
    document.body.append(internal);
    internal.click();
    expect(tauriMocks.openUrl).toHaveBeenCalledTimes(2);
    dispose();
  });

  it('blocks context menus and dragging links or images', () => {
    const dispose = setupWebviewGuards();
    const context = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    window.dispatchEvent(context);
    expect(context.defaultPrevented).toBe(true);
    const image = document.createElement('img');
    document.body.append(image);
    const drag = new Event('dragstart', { bubbles: true, cancelable: true });
    image.dispatchEvent(drag);
    expect(drag.defaultPrevented).toBe(true);
    dispose();
  });

  it('blocks navigation drag payloads and preserves ordinary drags', () => {
    const dispose = setupWebviewGuards();
    const payload = { files: [new File(['x'], 'a.md')], types: ['Files'], dropEffect: 'copy' };
    const dragOver = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(dragOver, 'dataTransfer', { value: payload });
    window.dispatchEvent(dragOver);
    expect(dragOver.defaultPrevented).toBe(true);
    expect(payload.dropEffect).toBe('none');
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: payload });
    window.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);

    const ordinary = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(ordinary, 'dataTransfer', {
      value: { files: [], types: ['text/plain'], dropEffect: 'copy' },
    });
    window.dispatchEvent(ordinary);
    expect(ordinary.defaultPrevented).toBe(false);
    dispose();
  });

  it('opens mail links and reports non-Error opener failures', async () => {
    const onError = vi.fn();
    tauriMocks.openUrl.mockRejectedValue('blocked');
    const dispose = setupWebviewGuards({ onError });
    const link = document.createElement('a');
    link.href = 'mailto:test@example.com';
    document.body.append(link);
    link.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith('Could not open the external link.');
    dispose();
  });

  it('covers harmless keyboard, click, and drag variants', () => {
    const dispose = setupWebviewGuards();

    for (const init of [
      { key: 'ArrowRight', altKey: true },
      { key: 'x', ctrlKey: true },
      { key: 'p', ctrlKey: true, shiftKey: true },
      { key: 'Backspace' },
    ]) {
      const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true });
      if (init.key === 'Backspace') {
        const wrapper = document.createElement('div');
        wrapper.setAttribute('contenteditable', 'true');
        const child = document.createElement('span');
        wrapper.append(child);
        document.body.append(wrapper);
        child.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
      } else {
        window.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(init.altKey === true);
      }
    }

    const prevented = new MouseEvent('click', { bubbles: true, cancelable: true });
    prevented.preventDefault();
    window.dispatchEvent(prevented);

    const emptyLink = document.createElement('a');
    emptyLink.setAttribute('href', '');
    document.body.append(emptyLink);
    emptyLink.click();
    const invalidLink = document.createElement('a');
    invalidLink.setAttribute('href', 'http://[');
    document.body.append(invalidLink);
    invalidLink.click();

    const ordinary = document.createElement('span');
    document.body.append(ordinary);
    const dragStart = new Event('dragstart', { bubbles: true, cancelable: true });
    ordinary.dispatchEvent(dragStart);
    expect(dragStart.defaultPrevented).toBe(false);

    const noPayload = new Event('dragover', { bubbles: true, cancelable: true });
    window.dispatchEvent(noPayload);
    expect(noPayload.defaultPrevented).toBe(false);
    const uriPayload = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(uriPayload, 'dataTransfer', {
      value: { files: [], types: ['text/uri-list'] },
    });
    window.dispatchEvent(uriPayload);
    expect(uriPayload.defaultPrevented).toBe(true);
    dispose();
  });
});
