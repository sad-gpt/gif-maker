import { expect, it, vi } from 'vitest';
import { clipboardFiles, normalizeClipboardImages, prepareUploads } from './uploads';
it('recognizes extensionless WhatsApp WebP and preserves every byte', async () => {
  const original = new File(['RIFF1234WEBPVP8Xanimated-content'], 'WhatsApp Sticker 12.49.45', { type: 'application/octet-stream' });
  const [image] = await normalizeClipboardImages([original]);
  expect(image.name).toBe('WhatsApp Sticker 12.49.45.webp');
  expect(image.type).toBe('image/webp');
  expect(await image.arrayBuffer()).toEqual(await original.arrayBuffer());
});
it('reads multiple clipboard files once and ignores text representations', () => {
  const first = new File(['a'], 'a.png'), second = new File(['b'], 'b.gif');
  const transfer = { items: [{ kind: 'string' }, { kind: 'file', getAsFile: () => first }, { kind: 'file', getAsFile: () => second }], files: [first,second] } as unknown as DataTransfer;
  expect(clipboardFiles(transfer)).toEqual([first,second]);
});
it('corrects a misleading clipboard extension from the actual image header', async () => {
  const [image] = await normalizeClipboardImages([new File(['GIF89aimage'], 'image.png')]);
  expect(image.name).toBe('image.gif'); expect(image.type).toBe('image/gif');
});

it('normalises JFIF and recognises AVIF and BMP without changing bytes', async () => {
  const originals = [new File([new Uint8Array([255,216,255,224])], 'photo.jfif'), new File(['0000ftypavif0000'], 'photo.avif'), new File(['BMimage'], 'photo.bmp')];
  const images = await normalizeClipboardImages(originals);
  expect(images.map(image => image.name)).toEqual(['photo.jpg', 'photo.avif', 'photo.bmp']);
  for (let i = 0; i < images.length; i++) expect(await images[i].arrayBuffer()).toEqual(await originals[i].arrayBuffer());
});
it('explains unsupported phone formats instead of silently skipping them', async () => {
  const result = await prepareUploads([new File(['heic'], 'IMG_1.HEIC', { type: 'image/heic' })], []);
  expect(result.added).toHaveLength(0);
  expect(result.rejected[0].reason).toContain('HEIC/HEIF');
});
it('accepts extensionless files on the normal upload path and preserves animation bytes', async () => {
  vi.stubGlobal('Image', class { onload?: () => void; set src(_value: string) { queueMicrotask(() => this.onload?.()); } });
  try {
    const file = new File(['GIF89aanimation'], 'sticker');
    const result = await prepareUploads([file], []);
    expect(result.skipped).toBe(0); expect(result.added[0].extension).toBe('gif');
    expect(await result.added[0].blob.arrayBuffer()).toEqual(await file.arrayBuffer());
    URL.revokeObjectURL(result.added[0].url);
  } finally { vi.unstubAllGlobals(); }
});
