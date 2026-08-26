import { getCurrentWebview } from '@tauri-apps/api/webview';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;
let zoom = 1;

async function apply(next: number): Promise<void> {
  zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(next * 10) / 10));
  await getCurrentWebview().setZoom(zoom);
}

export const zoomActions = {
  increase: () => apply(zoom + ZOOM_STEP),
  decrease: () => apply(zoom - ZOOM_STEP),
  reset: () => apply(1),
};
