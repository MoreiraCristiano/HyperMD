import { getCurrentWindow } from '@tauri-apps/api/window';

export type WindowCloseEvent = { preventDefault(): void };

export function setWindowTitle(title: string): Promise<void> {
  return getCurrentWindow().setTitle(title);
}

export function closeWindow(): Promise<void> {
  return getCurrentWindow().close();
}

export function destroyWindow(): Promise<void> {
  return getCurrentWindow().destroy();
}

export function minimizeWindow(): Promise<void> {
  return getCurrentWindow().minimize();
}

export function isWindowMaximized(): Promise<boolean> {
  return getCurrentWindow().isMaximized();
}

export async function toggleWindowMaximized(): Promise<void> {
  const window = getCurrentWindow();
  if (await window.isMaximized()) await window.unmaximize();
  else await window.maximize();
}

export function onWindowCloseRequested(
  handler: (event: WindowCloseEvent) => void,
): Promise<() => void> {
  return getCurrentWindow().onCloseRequested(handler);
}

export function onWindowResized(handler: () => void): Promise<() => void> {
  return getCurrentWindow().onResized(handler);
}
