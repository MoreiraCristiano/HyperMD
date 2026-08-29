import { getCurrentWebview } from '@tauri-apps/api/webview';

export function setWebviewZoom(zoom: number): Promise<void> {
  return getCurrentWebview().setZoom(zoom);
}
