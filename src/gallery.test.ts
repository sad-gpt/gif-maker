import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createGalleryZip, galleryHTML } from './gallery';
import { DEFAULT_SETTINGS } from './types';
import type { GalleryItem } from './types';

const bytes = new Uint8Array([71, 73, 70, 56, 57, 97]);
const item: GalleryItem = { id: '1', name: 'a.gif', caption: '<img src=x onerror=alert(1)>', blob: new Blob([bytes], { type: 'image/gif' }), url: 'blob:preview-only', extension: 'gif' };
describe('portable gallery export', () => {
  it('escapes user text and limits injected layout and colour values', () => {
    const html = galleryHTML([item], { ...DEFAULT_SETTINGS, title: '</title><script>alert(1)</script>', description: '" onload="alert(1)', background: 'red; } body { display:none' }, ['images/01.gif']);
    expect(html).toContain('&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('body { display:none');
    expect(html).not.toContain('blob:preview-only');
    expect(html).toContain('src="images/01.gif"');
  });
  it('bundles original image bytes, preserves order and includes an offline entry point', async () => {
    const second = { ...item, id: '2', extension: 'png', blob: new Blob(['second-file']) };
    const blob = await createGalleryZip([second, item], { ...DEFAULT_SETTINGS, template: 'scrapbook', title: 'our people' }, async () => new Blob(['test-font']));
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(await zip.file('images/01.png')!.async('string')).toBe('second-file');
    expect(await zip.file('images/02.gif')!.async('uint8array')).toEqual(bytes);
    const html = await zip.file('index.html')!.async('string');
    expect(html).toContain('gallery scrapbook');
    expect(html.indexOf('src="images/01.png"')).toBeLessThan(html.indexOf('src="images/02.gif"'));
    expect(html).not.toMatch(/src="(?:blob:|https:)/);
    expect(zip.file('START-HERE.txt')).not.toBeNull();
    expect(zip.file('.nojekyll')).not.toBeNull();
    expect(await zip.file('fonts/lora.woff2')!.async('string')).toBe('test-font');
    const manifest = JSON.parse(await zip.file('gallery.json')!.async('string'));
    expect(manifest.items.map((item: { path: string }) => item.path)).toEqual(['images/01.png', 'images/02.gif']);
    expect(html).toContain("font-family:'DM Sans'");
  });
  it('omits captions when disabled while keeping accessible image labels', () => {
    const html = galleryHTML([item], { ...DEFAULT_SETTINGS, captions: false }, ['images/01.gif']);
    expect(html).not.toContain('<figcaption>');
    expect(html).toContain('aria-label="Open &lt;img');
  });
});
