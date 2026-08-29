import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { tauriMocks } from '@/test/tauriMocks';
import TitleBar from './TitleBar.svelte';

describe('TitleBar', () => {
  it('toggles maximize on background double click and reports errors', async () => {
    const api = {
      isMaximized: vi.fn().mockResolvedValue(false),
      maximize: vi.fn().mockResolvedValue(undefined),
      unmaximize: vi.fn().mockResolvedValue(undefined),
      minimize: vi.fn().mockResolvedValue(undefined),
      onResized: vi.fn().mockResolvedValue(vi.fn()),
    };
    tauriMocks.getCurrentWindow.mockReturnValue(api);
    const onError = vi.fn();
    const view = render(TitleBar, { onExit: vi.fn(), onError });
    const header = view.container.querySelector('header')!;
    await fireEvent.doubleClick(header);
    await waitFor(() => expect(api.maximize).toHaveBeenCalled());
    api.isMaximized.mockResolvedValue(true);
    await fireEvent.doubleClick(header);
    await waitFor(() => expect(api.unmaximize).toHaveBeenCalled());
    api.isMaximized.mockRejectedValueOnce(new Error('window failed'));
    await fireEvent.doubleClick(header);
    expect(onError).toHaveBeenCalledWith('window failed');
    await fireEvent.doubleClick(screen.getByRole('tablist'));

    const maximizeCalls = api.maximize.mock.calls.length;
    await fireEvent.doubleClick(screen.getByRole('button', { name: /Maximize|Restore/ }));
    expect(api.maximize).toHaveBeenCalledTimes(maximizeCalls);
    api.isMaximized.mockRejectedValueOnce('plain failure');
    await fireEvent.doubleClick(header);
    expect(onError).toHaveBeenCalledWith('plain failure');
  });
});
