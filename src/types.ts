export type Template = 'grid' | 'collage' | 'scrapbook';
export type GalleryItem = { id: string; name: string; caption: string; url: string; blob: Blob; extension: string };
export type GallerySettings = { title: string; description: string; template: Template; background: string; captions: boolean };
export const DEFAULT_SETTINGS: GallerySettings = { title: '', description: '', template: 'grid', background: '#f6efdf', captions: true };
export const MAX_FILES = 60;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 150 * 1024 * 1024;
export const IMAGE_TYPES = /\.(gif|webp|png|jpe?g|jfif|avif|bmp)$/i;
