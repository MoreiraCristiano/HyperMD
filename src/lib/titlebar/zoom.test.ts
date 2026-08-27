import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tauriMocks } from '../../test/tauriMocks';

describe('zoom actions', () => {
  beforeEach(() => vi.resetModules());

  it('steps, resets, and clamps webview zoom', async () => {
    const setZoom = vi.fn().mockResolvedValue(undefined);
    tauriMocks.getCurrentWebview.mockReturnValue({ setZoom });
    const { zoomActions } = await import('./zoom');
    await zoomActions.increase();
    await zoomActions.decrease();
    await zoomActions.reset();
    expect(setZoom.mock.calls.map(([value]) => value)).toEqual([1.1, 1, 1]);
    for (let index = 0; index < 20; index += 1) await zoomActions.decrease();
    expect(setZoom).toHaveBeenLastCalledWith(0.5);
    for (let index = 0; index < 30; index += 1) await zoomActions.increase();
    expect(setZoom).toHaveBeenLastCalledWith(2);
  });
});
