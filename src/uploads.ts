import { IMAGE_TYPES, MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES } from './types';
import type { GalleryItem } from './types';

export function clipboardFiles(transfer: DataTransfer): File[] {
  // Read synchronously: clipboard DataTransfer access ends after the paste event.
  const files = Array.from(transfer.items).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => file !== null);
  return files.length ? files : Array.from(transfer.files);
}

export async function normalizeClipboardImages(files: File[]): Promise<File[]> {
  const images: File[] = [];
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) { images.push(file); continue; }
    const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    const extension = text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP' ? 'webp'
      : /^GIF8[79]a/.test(text) ? 'gif'
      : bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 ? 'png'
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpg'
      : text.startsWith('BM') ? 'bmp'
      : text.slice(4, 8) === 'ftyp' && /avif|avis/.test(text.slice(8)) ? 'avif' : undefined;
    if (!extension) { images.push(file); continue; }
    const name = file.name.replace(/\.(gif|webp|png|jpe?g|jfif|avif|bmp)$/i, '') || `pasted-sticker-${images.length + 1}`;
    images.push(new File([file], `${name}.${extension}`, { type: extension === 'jpg' ? 'image/jpeg' : `image/${extension}` }));
  }
  return images;
}

export async function prepareUploads(files: File[], existing: GalleryItem[]) {
  const added: GalleryItem[] = [];
  let skipped = 0;
  const rejected: { name: string; reason: string }[] = [];
  const reject = (file: File, reason: string) => { skipped++; rejected.push({ name: file.name, reason }); };
  let total = existing.reduce((sum, item) => sum + item.blob.size, 0);
  for (let file of files) {
    if (file.size > MAX_FILE_BYTES) { reject(file, 'over the 20 MB per-image limit'); continue; }
    if (existing.length + added.length >= MAX_FILES) { reject(file, 'gallery already has 60 images'); continue; }
    if (total + file.size > MAX_TOTAL_BYTES) { reject(file, 'would exceed the 150 MB gallery limit'); continue; }
    const [normalised] = await normalizeClipboardImages([file]);
    file = normalised;
    if (!IMAGE_TYPES.test(file.name)) {
      reject(file, /\.(heic|heif)$/i.test(file.name) || /image\/hei[cf]/i.test(file.type)
        ? 'HEIC/HEIF is not supported yet. Export this photo as JPEG or PNG'
        : 'unsupported format. Use JPEG, PNG, GIF, WebP, AVIF or BMP');
      continue;
    }
    const url = URL.createObjectURL(file);
    try {
      await new Promise<void>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve();
        image.onerror = reject;
        image.src = url;
      });
      added.push({ id: crypto.randomUUID(), name: file.name, caption: '', url, blob: file, extension: file.name.split('.').pop()!.toLowerCase() });
      total += file.size;
    } catch { URL.revokeObjectURL(url); reject(file, 'could not be read by this browser. Try exporting it as JPEG or PNG'); }
  }
  return { added, skipped, rejected };
}

type Entry = { isFile: boolean; isDirectory: boolean; file: (success: (file: File) => void, error: (error: unknown) => void) => void; createReader: () => { readEntries: (success: (entries: Entry[]) => void, error: (error: unknown) => void) => void } };
async function readEntry(entry: Entry): Promise<File[]> {
  if (entry.isFile) return [await new Promise<File>((resolve, reject) => entry.file(resolve, reject))];
  if (!entry.isDirectory) return [];
  const reader = entry.createReader();
  const files: File[] = [];
  while (true) {
    const entries = await new Promise<Entry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!entries.length) break;
    for (const child of entries) files.push(...await readEntry(child));
  }
  return files;
}
export async function filesFromDrop(transfer: DataTransfer) {
  const entries = Array.from(transfer.items).map(item => item.webkitGetAsEntry?.() as Entry | null);
  if (entries.some(Boolean)) {
    const files: File[] = [];
    for (const entry of entries) if (entry) files.push(...await readEntry(entry));
    return files;
  }
  return Array.from(transfer.files);
}
