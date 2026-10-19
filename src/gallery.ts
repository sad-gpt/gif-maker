import type { GalleryItem, GallerySettings } from './types';

export function makerUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_ORIGIN;
  const fallback = typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:5173';
  try {
    const url = new URL(configured || fallback);
    if (url.protocol === 'https:' || url.protocol === 'http:') return `${url.origin}/`;
  } catch { /* Fall back to the editor origin if configuration is invalid. */ }
  return `${fallback}/`;
}

export const fontCSS = `@font-face{font-family:'DM Sans';font-style:normal;font-weight:100 1000;font-display:swap;src:url('./fonts/dm-sans.woff2') format('woff2')}@font-face{font-family:'Lora';font-style:normal;font-weight:400 700;font-display:swap;src:url('./fonts/lora.woff2') format('woff2')}@font-face{font-family:'Lora';font-style:italic;font-weight:400 700;font-display:swap;src:url('./fonts/lora-italic.woff2') format('woff2')}`;

export const galleryCSS = `
.gallery { color:#51443e; padding:42px 38px 28px; min-height:540px; }
.gallery-heading { text-align:center; margin:0 auto 30px; max-width:560px; }
.gallery-eyebrow { display:block; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:2.5px; margin-bottom:12px; opacity:.6; }
.gallery h2 { font-family: 'Lora', Georgia, serif; font-weight:500; font-size:clamp(28px,3vw,42px); line-height:1.18; margin:0 0 12px; overflow-wrap:anywhere; }
.gallery-heading p { font-size:12px; line-height:1.7; margin:0; opacity:.7; white-space:pre-wrap; overflow-wrap:anywhere; }
.gallery-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:18px 14px; }
.gallery-card { margin:0; min-width:0; position:relative; }
.gallery-image { display:block; width:100%; aspect-ratio:1.2; object-fit:cover; border-radius:9px; background:rgba(255,255,255,.4); }
.gallery-open { display:block; width:100%; padding:0; border:0; background:none; border-radius:9px; cursor:zoom-in; transition:transform .22s; }
.gallery-open:hover { transform:translateY(-3px) rotate(-1deg); }
.gallery-open:focus-visible { outline:3px solid #a75c70; outline-offset:4px; }
.gallery-card figcaption { margin:9px 3px 0; font-size:10px; line-height:1.55; text-align:center; overflow-wrap:anywhere; }
.gallery-footer { display:flex; align-items:center; justify-content:center; margin:34px 0 0; font-size:14px; }
.gallery-credit { display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:44px; padding:6px 12px; color:inherit; text-decoration:none; opacity:.8; border-radius:8px; transition:opacity .2s; }
.gallery-credit strong { font-weight:600; }
.gallery-credit:hover { opacity:1; text-decoration:underline; text-underline-offset:4px; }
.gallery-credit:focus-visible { outline:2px solid currentColor; outline-offset:3px; opacity:1; }
.gallery-footer span { font-size:17px; }
.gallery.collage .gallery-grid { grid-template-columns:repeat(3,minmax(0,1fr)); align-items:start; }
.gallery.collage .gallery-card:nth-child(3n+2) { margin-top:25px; }
.gallery.collage .gallery-card:nth-child(3n+1) .gallery-image { aspect-ratio: .88; }
.gallery.collage .gallery-card:nth-child(3n+2) .gallery-image { aspect-ratio:1.05; }
.gallery.collage .gallery-card:nth-child(3n) .gallery-image { aspect-ratio:1.3; }
.gallery.scrapbook .gallery-grid { gap:25px 19px; padding:8px; }
.gallery.scrapbook .gallery-card { background:#fffdf8; padding:9px 9px 14px; box-shadow:0 3px 8px #55443412; transform:rotate(-3deg); }
.gallery.scrapbook .gallery-card:nth-child(2n) { transform:rotate(3deg); }
.gallery.scrapbook .gallery-card:nth-child(3n) { transform:rotate(-1deg); }
.gallery.scrapbook .gallery-image,.gallery.scrapbook .gallery-open { border-radius:2px; }
.gallery.scrapbook .gallery-card:before { content:''; position:absolute; z-index:1; width:40px; height:14px; background:#d4c5a780; top:-6px; left:calc(50% - 20px); transform:rotate(-5deg); pointer-events:none; }
.gallery.scrapbook .gallery-card figcaption { font-family:Georgia,serif; font-style:italic; }
.gallery.phone { padding:32px 18px 24px; }
.gallery.phone .gallery-grid { grid-template-columns:repeat(2,minmax(0,1fr)); gap:18px 12px; }
.gallery.phone h2 { font-size:30px; }
.gallery.phone .gallery-card figcaption { font-size:10px; }
@media(max-width:540px) { .gallery { padding:32px 18px 24px; }.gallery .gallery-grid,.gallery.collage .gallery-grid { grid-template-columns:repeat(2,minmax(0,1fr)); gap:18px 12px; }.gallery h2 { font-size:30px; } }
@media(prefers-reduced-motion:reduce) { *,*:before,*:after { animation:none!important; transition:none!important; scroll-behavior:auto!important; } }
`;

export function escapeHTML(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export type GalleryManifest = { format: 'gif-and-giggles'; version: 1; settings: GallerySettings; items: { id: string; name: string; caption: string; path: string; extension: string }[] };
export type GalleryFile = { path: string; blob: Blob };
const assetNames = ['dm-sans.woff2', 'lora.woff2', 'lora-italic.woff2', 'OFL-dm-sans.txt', 'OFL-lora.txt'];
export async function loadFontAsset(name: string) {
  const response = await fetch(`/fonts/${name}`);
  if (!response.ok || response.headers.get('content-type')?.includes('text/html')) throw new Error('A gallery font could not be loaded. Please refresh and try again.');
  return response.blob();
}
export async function createGalleryFiles(items: GalleryItem[], settings: GallerySettings, loadAsset = loadFontAsset) {
  const paths = items.map((item, i) => `images/${String(i + 1).padStart(2, '0')}.${item.extension}`);
  const manifest: GalleryManifest = { format: 'gif-and-giggles', version: 1, settings, items: items.map((item, i) => ({ id: item.id, name: item.name, caption: item.caption, path: paths[i], extension: item.extension })) };
  const files: GalleryFile[] = items.map((item, i) => ({ path: paths[i], blob: item.blob }));
  files.push({ path: 'index.html', blob: new Blob([galleryHTML(items, settings, paths)], { type: 'text/html' }) }, { path: 'gallery.json', blob: new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }) }, { path: '.nojekyll', blob: new Blob([]) });
  files.push({ path: 'START-HERE.txt', blob: new Blob(['Your gallery is ready to share!\n\n1. Unzip this folder.\n2. Open index.html to enjoy your gallery offline. Keep images/ and fonts/ beside it.\n3. For a public link, visit https://app.netlify.com/drop and drop the unzipped folder. Follow Netlify’s account and public visibility steps.\n4. You can also use Publish with GitHub in gif & giggles.\n\nYour images, captions, design and fonts are included. Your editor draft saves on your device.\n']) });
  files.push(...await Promise.all(assetNames.map(async name => ({ path: `fonts/${name}`, blob: await loadAsset(name) }))));
  return { manifest, files };
}
export async function describeFiles(files: GalleryFile[]) {
  const descriptions = [];
  for (const file of files) {
    const digest = await crypto.subtle.digest('SHA-256', await file.blob.arrayBuffer());
    descriptions.push({ path: file.path, size: file.blob.size, digest: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') });
  }
  return descriptions;
}
export async function createGalleryZip(items: GalleryItem[], settings: GallerySettings, loadAsset = loadFontAsset) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const { files } = await createGalleryFiles(items, settings, loadAsset);
  for (const file of files) zip.file(file.path, await file.blob.arrayBuffer());
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

export function galleryHTML(items: GalleryItem[], settings: GallerySettings, paths: string[]) {
  const safeTitle = escapeHTML(settings.title.trim() || 'a little collection of moments');
  const cards = items.map((item, i) => `<figure class="gallery-card"><button class="gallery-open" data-index="${i}" aria-label="Open ${escapeHTML(item.caption || item.name)}"><img class="gallery-image" src="${escapeHTML(paths[i])}" alt="${escapeHTML(item.caption || item.name)}" loading="lazy"/></button>${settings.captions && item.caption ? `<figcaption>${escapeHTML(item.caption)}</figcaption>` : ''}</figure>`).join('');
  const background = /^#[a-f\d]{6}$/i.test(settings.background) ? settings.background : '#f6efdf';
  const template = ['grid', 'collage', 'scrapbook'].includes(settings.template) ? settings.template : 'grid';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><meta name="description" content="${escapeHTML(settings.description)}"/><title>${safeTitle}</title><style>*{box-sizing:border-box}body{margin:0;background:${background};font-family:'DM Sans',sans-serif}.gallery{max-width:1000px;margin:0 auto;padding-top:65px}button{font:inherit}${fontCSS}${galleryCSS}dialog{border:0;border-radius:16px;padding:16px;background:#fffaf3;max-width:90vw;color:#51443e}dialog::backdrop{background:#302725bb}dialog img{display:block;max-height:75vh;max-width:100%;margin:auto;object-fit:contain}dialog p{text-align:center;font-size:14px}dialog button{display:block;margin:0 0 12px auto;border:1px solid #ded4ca;border-radius:20px;background:white;padding:7px 16px;cursor:pointer}</style></head><body><main class="gallery ${template}"><header class="gallery-heading"><h2>${safeTitle}</h2>${settings.description ? `<p>${escapeHTML(settings.description)}</p>` : ''}</header><div class="gallery-grid">${cards}</div><footer class="gallery-footer"><a class="gallery-credit" href="${escapeHTML(makerUrl())}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">♡</span> made with <strong>gif &amp; giggles</strong></a></footer></main><dialog aria-label="Image viewer"><button aria-label="Close image viewer">Close ×</button><img alt=""/><p></p></dialog><script>const viewer=document.querySelector('dialog');let previous;document.querySelectorAll('.gallery-open').forEach(button=>button.addEventListener('click',()=>{previous=button;const image=button.querySelector('img');viewer.querySelector('img').src=image.src;viewer.querySelector('img').alt=image.alt;viewer.querySelector('p').textContent=image.alt;viewer.showModal()}));viewer.querySelector('button').addEventListener('click',()=>viewer.close());viewer.addEventListener('click',event=>{if(event.target===viewer){const r=viewer.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)viewer.close()}});viewer.addEventListener('close',()=>previous?.focus());</script></body></html>`;
}
