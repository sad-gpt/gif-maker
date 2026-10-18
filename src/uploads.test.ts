import { expect, it } from 'vitest';
import { clipboardFiles, normalizeClipboardImages } from './uploads';
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
