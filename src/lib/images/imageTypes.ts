const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'svg',
  'bmp',
  'ico',
  'avif',
]);

export function fileExtension(path: string): string {
  const match = path.match(/\.([^.\\/]+)$/);
  return match?.[1].toLowerCase() ?? '';
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(fileExtension(path));
}

export const supportedImageExtensions = [...IMAGE_EXTENSIONS];
