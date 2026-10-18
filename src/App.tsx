'use client';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, FolderPlus, GripVertical, Heart, ImagePlus, Info, Maximize2, Monitor, Pencil, Plus, Smartphone, Sparkles, X } from 'lucide-react';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DEFAULT_SETTINGS, MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES } from './types';
import type { GalleryItem, GallerySettings, Template } from './types';
import { DEMO_DESCRIPTION, DEMO_TITLE, makeDemoItems } from './demo';
import { createGalleryZip, galleryCSS, makerUrl } from './gallery';
import { clipboardFiles, filesFromDrop, normalizeClipboardImages, prepareUploads } from './uploads';
import PublishPanel from './PublishPanel';
import { readLocal, saveDraft } from './draft';
import type { Draft, Publication } from './draft';

const demoItems = makeDemoItems();
const colors = [{ value: '#f6efdf', name: 'Vanilla' }, { value: '#f4e4e5', name: 'Rosewater' }, { value: '#e8e9dc', name: 'Pistachio' }, { value: '#eae4f0', name: 'Lavender' }, { value: '#e2ebee', name: 'Cloud' }, { value: '#faf9f5', name: 'Paper' }];
const templates: { id: Template; name: string }[] = [{ id: 'grid', name: 'The classic' }, { id: 'collage', name: 'A little chaos' }, { id: 'scrapbook', name: 'Dear diary' }];

function Bow({ className = '' }: { className?: string }) {
  return <svg className={className} width="40" height="38" viewBox="0 0 50 46" fill="none" aria-hidden="true"><path d="M24 23C10 27 3 18 7 10c4-7 15 4 18 12C29 10 40 5 44 12c5 10-10 17-19 11m-3 1c-2 8-5 13-11 16m16-16c2 7 6 13 12 15" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/><path d="m20 22 10-1-1 6-8-1Z" fill="currentColor"/></svg>;
}

function Modal({ children, title, onClose, className = '' }: { children: ReactNode; title: string; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    const cancel = (event: Event) => { event.preventDefault(); closeRef.current(); };
    dialog.addEventListener('cancel', cancel);
    return () => { dialog.removeEventListener('cancel', cancel); dialog.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <dialog ref={ref} className={`modal ${className}`} aria-label={title} onClick={e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }}><button className="icon-button modal-close" onClick={onClose} aria-label={`Close ${title}`}><X size={20}/></button>{children}</dialog>;
}

function Gallery({ items, settings, phone = false, onOpen, onEditCaption }: { items: GalleryItem[]; settings: GallerySettings; phone?: boolean; onOpen: (index: number) => void; onEditCaption?: (id: string) => void }) {
  return <div className={`gallery ${settings.template}${phone ? ' phone' : ''}`} style={{ background: settings.background }}>
    <div className="gallery-heading"><h2>{settings.title.trim() || 'the group chat hall of fame'}</h2>{settings.description && <p>{settings.description}</p>}</div>
    <div className="gallery-grid">{items.map((item, i) => <figure className="gallery-card" key={item.id}><button className="gallery-open" onClick={() => onOpen(i)} aria-label={`Open ${item.caption || item.name}`}><img className="gallery-image" src={item.url} alt={item.caption || item.name} loading="lazy"/></button>{settings.captions && item.caption && <figcaption>{item.caption}</figcaption>}{onEditCaption && <button className="caption-edit-button" onClick={() => onEditCaption(item.id)} aria-label={`${item.caption ? 'Edit' : 'Add'} caption for ${item.name}`}><Pencil size={11}/>{item.caption ? 'Edit caption' : 'Add caption'}</button>}</figure>)}</div>
    <div className="gallery-footer"><a className="gallery-credit" href={makerUrl()} target="_blank" rel="noopener noreferrer"><Heart size={16} aria-hidden="true"/> made with <strong>gif &amp; giggles</strong></a></div>
  </div>;
}

function SortableItem({ item, index, onCaption, onRemove }: { item: GalleryItem; index: number; onCaption: (caption: string) => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  return <div ref={setNodeRef} className={`item-row ${isDragging ? 'dragging' : ''}`} style={{ transform: CSS.Transform.toString(transform), transition }}>
    <button className="drag-handle" {...attributes} {...listeners} aria-label={`Reorder ${item.name}`}><GripVertical size={15}/></button>
    <img src={item.url} alt=""/><div className="item-fields"><span title={item.name}>{index + 1}. {item.name}</span><div className="inline-caption"><Pencil size={10}/><input aria-label={`Caption for ${item.name}`} placeholder="Add your punchline…" maxLength={100} value={item.caption} onChange={e => onCaption(e.target.value)}/></div></div>
    <button className="icon-button remove" onClick={onRemove} aria-label={`Remove ${item.name}`}><X size={14}/></button>
  </div>;
}

export default function App() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [settings, setSettings] = useState<GallerySettings>(DEFAULT_SETTINGS);
  const [tab, setTab] = useState<'content' | 'style'>('content');
  const [phone, setPhone] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState<'help' | 'publish' | 'preview' | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [editingCaption, setEditingCaption] = useState<string | null>(null);
  const [captionDraft, setCaptionDraft] = useState('');
  const [publication, setPublication] = useState<Publication | undefined>();
  const [draftReady, setDraftReady] = useState(false);
  const [draftState, setDraftState] = useState<'saving' | 'saved' | 'failed'>('saved');
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const itemsRef = useRef(items);
  const uploadLock = useRef(false);
  const objectUrls = useRef(new Set<string>());
  itemsRef.current = items;
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const target = event.target;
      if (!draftReady || modal || editingCaption || (target instanceof Element && target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])'))) return;
      if (!event.clipboardData) return;
      const files = clipboardFiles(event.clipboardData);
      if (!files.length) {
        setNotice('No image found on the clipboard. Try “Copy image” on the sticker in WhatsApp Web, or save it and choose the file.');
        return;
      }
      event.preventDefault();
      if (uploadLock.current) { setNotice('Still adding the last batch. Paste again in a moment.'); return; }
      void upload(files, true);
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, [draftReady, modal, editingCaption]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  useEffect(() => {
    let cancelled = false;
    void readLocal<Draft>('current').then(draft => {
      if (cancelled) return;
      if (draft) {
        const restored = draft.items.map(item => { const url = URL.createObjectURL(item.blob); objectUrls.current.add(url); return { ...item, url }; });
        setItems(restored); setSettings(draft.settings); setPublication(draft.publication);
      }
    }).catch(() => { if (!cancelled) setDraftState('failed'); }).finally(() => { if (!cancelled) setDraftReady(true); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!draftReady) return;
    setDraftState('saving');
    let cancelled = false;
    const timer = window.setTimeout(() => { void saveDraft(items, settings, publication).then(() => { if (!cancelled) setDraftState('saved'); }).catch(() => { if (!cancelled) setDraftState('failed'); }); }, 350);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [items, settings, publication, draftReady]);
  useEffect(() => { const urls = objectUrls.current; return () => urls.forEach(url => URL.revokeObjectURL(url)); }, []);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 6500); return () => window.clearTimeout(timer); }, [notice]);
  useEffect(() => {
    if (!items.length || draftState === 'saved') return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [items.length, draftState]);
  function update<K extends keyof GallerySettings>(key: K, value: GallerySettings[K]) { setSettings(current => ({ ...current, [key]: value })); }
  function editCaption(id: string) {
    const item = (items.length ? items : demoItems).find(item => item.id === id);
    if (!item) return;
    if (!items.length) {
      setItems(makeDemoItems());
      setSettings(current => ({ ...current, title: current.title || DEMO_TITLE, description: current.description || DEMO_DESCRIPTION }));
    }
    setCaptionDraft(item.caption);
    setEditingCaption(id);
  }
  function saveCaption() {
    setItems(current => current.map(item => item.id === editingCaption ? { ...item, caption: captionDraft.trim() } : item));
    setEditingCaption(null);
    setNotice('Caption saved. The lore has been updated.');
  }
  async function upload(files: File[], fromClipboard = false) {
    if (uploadLock.current) return;
    uploadLock.current = true;
    setUploading(true);
    try {
      const result = await prepareUploads(fromClipboard ? await normalizeClipboardImages(files) : files, itemsRef.current);
      result.added.forEach(item => objectUrls.current.add(item.url));
      setItems(current => [...current, ...result.added]);
      setNotice(result.skipped ? `${result.added.length} added; ${result.skipped} skipped. Use valid GIF, WebP, PNG or JPG files up to ${MAX_FILE_BYTES / 1024 / 1024} MB each (${MAX_FILES} files / ${MAX_TOTAL_BYTES / 1024 / 1024} MB total).` : result.added.length ? `${result.added.length} ${result.added.length === 1 ? 'moment' : 'moments'} added to the hall of fame. Their legacy is in your hands.` : 'No GIFs or images in there. The lore must be in another folder.');
    } catch { setNotice('Those files could not be read. Try selecting the images directly.'); }
    finally { setUploading(false); uploadLock.current = false; }
  }
  function remove(id: string) {
    const item = items.find(item => item.id === id);
    if (item?.url.startsWith('blob:')) { URL.revokeObjectURL(item.url); objectUrls.current.delete(item.url); }
    setItems(current => current.filter(item => item.id !== id));
  }
  function loadDemo() { setItems(makeDemoItems()); setSettings(current => ({ ...current, title: current.title || DEMO_TITLE, description: current.description || DEMO_DESCRIPTION })); setNotice('Meet the stunt doubles. Edit their captions, rearrange them, or add your own friends.'); }
  async function download() {
    if (!items.length || exporting) return false;
    setExporting(true);
    try {
      const blob = await createGalleryZip(items, settings);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `${settings.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0,60) || 'gif-and-giggles'}.zip`;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      return true;
    } catch { setNotice('The download could not be created. Try again with fewer or smaller images.'); return false; }
    finally { setExporting(false); }
  }
  const isDemo = !items.length;
  const shownItems = isDemo ? demoItems : items;
  const shownSettings = isDemo ? { ...settings, title: settings.title || DEMO_TITLE, description: settings.description || DEMO_DESCRIPTION } : settings;
  const activeImage = lightbox !== null ? shownItems[lightbox] : undefined;
  const captionItem = items.find(item => item.id === editingCaption);

  if (!draftReady) return <main className="draft-loading">Opening your GIF scrapbook…</main>;
  return <>
    <style>{galleryCSS}</style>
    <header className="site-header"><a className="brand" href="#" aria-label="GIF & Giggles home"><Bow/><span>gif <span className="brand-amp">&</span> giggles<span className="brand-dot">.</span></span></a><div className="header-right"><button className="help-button" onClick={() => setModal('help')}>How it works</button></div></header>
    <main>
      <section className="intro"><div className="intro-kicker"><span/> a GIF gallery maker for your group chat</div><h1>Your friends’ GIFs.<br/><em>A tiny hall of fame.</em><svg className="title-spark" viewBox="0 0 50 55" aria-hidden="true"><path d="m11 21 12 5m1-17 3 13m16-7-9 11" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg></h1><p>Upload your funniest GIFs, write the captions, and pick a cute layout.<br/>Publish with GitHub or download for Netlify. Your friends, officially a website.</p></section>
      <section className="workspace" aria-label="Gallery editor">
        <aside className="editor-panel">
          <div className="editor-tabs" role="tablist" aria-label="Editor sections"><button id="content-tab" role="tab" aria-selected={tab === 'content'} aria-controls="content-panel" onClick={() => setTab('content')} className={tab === 'content' ? 'active' : ''}><ImagePlus size={15}/> Your GIFs</button><button id="style-tab" role="tab" aria-selected={tab === 'style'} aria-controls="style-panel" onClick={() => setTab('style')} className={tab === 'style' ? 'active' : ''}><Sparkles size={15}/> The look</button></div>
          <div className="editor-body" id={tab === 'content' ? 'content-panel' : 'style-panel'} role="tabpanel" aria-labelledby={tab === 'content' ? 'content-tab' : 'style-tab'}>
            {tab === 'content' ? <>
              <div className={`dropzone ${dragOver ? 'over' : ''} ${uploading ? 'busy' : ''}`} onDragOver={e => { e.preventDefault(); if (!uploading) setDragOver(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }} onDrop={async e => { e.preventDefault(); setDragOver(false); if (uploadLock.current) return; const transfer = e.dataTransfer; try { await upload(await filesFromDrop(transfer)); } catch { setNotice('That folder could not be read. Use the folder button below instead.'); } }}>
                <div className="upload-illustration" aria-hidden="true"><div className="mini-photo back"/><div className="mini-photo front"><span>•ᴗ•</span><Heart size={12}/></div><span className="upload-spark">✧</span></div>
                <strong>{uploading ? 'Collecting the evidence…' : dragOver ? 'Release the nonsense!' : 'Drop your friends’ funniest GIFs'}</strong><span className="drop-hint">GIFs, stickers & other personality traits</span>
                <button className="primary small" disabled={uploading} onClick={() => fileInput.current?.click()}><Plus size={15}/> Choose files</button>
                <button className="folder-button" disabled={uploading} onClick={() => folderInput.current?.click()}><FolderPlus size={13}/> or choose a whole folder</button>
                <button className="folder-button" type="button" onClick={event => { event.currentTarget.focus(); setNotice('Copy a sticker image, then press Ctrl+V here (⌘V on Mac).'); }}>or copy a sticker & press Ctrl+V / ⌘V</button>
                <input ref={fileInput} type="file" accept=".gif,.webp,.png,.jpg,.jpeg" multiple hidden onChange={e => { void upload(Array.from(e.target.files || [])); e.target.value = ''; }}/>
                <input ref={node => { folderInput.current = node; node?.setAttribute('webkitdirectory', ''); }} type="file" multiple hidden onChange={e => { void upload(Array.from(e.target.files || [])); e.target.value = ''; }}/>
              </div>
              <p className="upload-limits">Up to {MAX_FILES} images · {MAX_FILE_BYTES / 1024 / 1024} MB each · {MAX_TOTAL_BYTES / 1024 / 1024} MB total</p>
              {items.length ? <div className="your-items"><div className="field-heading"><label>The evidence <span className="count">{items.length}/{MAX_FILES}</span></label><span>drag to rearrange</span></div><p className="caption-hint">Edit a caption below, or tap the pencil on any GIF.</p><DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => { if (over && active.id !== over.id) setItems(current => arrayMove(current, current.findIndex(i => i.id === active.id), current.findIndex(i => i.id === over.id))); }}><SortableContext items={items.map(item => item.id)} strategy={verticalListSortingStrategy}><div className="item-list">{items.map((item, index) => <SortableItem key={item.id} item={item} index={index} onCaption={caption => setItems(current => current.map(i => i.id === item.id ? { ...i, caption } : i))} onRemove={() => remove(item.id)}/>)}</div></SortableContext></DndContext></div> : <button className="sample-button" disabled={uploading} onClick={loadDemo}><Sparkles size={13}/> No GIFs handy? Borrow our weirdos <ArrowRight size={13}/></button>}
              <div className="field-group"><label htmlFor="gallery-title">Name your gallery <span>something they’ll never live down</span></label><input id="gallery-title" placeholder="e.g. Rahul’s greatest questionable hits" maxLength={80} value={settings.title} onChange={e => update('title', e.target.value)}/></div>
              <div className="field-group"><label htmlFor="gallery-description">Explain yourselves <span>optional, probably impossible</span></label><textarea id="gallery-description" rows={2} placeholder="Five friends. One brain cell. A lifetime of material." maxLength={180} value={settings.description} onChange={e => update('description', e.target.value)}/></div>
              <button className="next-step" onClick={() => setTab('style')}>Next: dress up the nonsense <ArrowRight size={15}/></button>
            </> : <>
              <div className="style-intro"><h3>Cute packaging. Chaotic contents.</h3><p>Pick a look worthy of their questionable talents.</p></div>
              <label className="standalone-label">Choose your gallery layout</label>
              <div className="template-options">{templates.map(template => <button key={template.id} className={`template-option ${settings.template === template.id ? 'selected' : ''}`} aria-pressed={settings.template === template.id} onClick={() => update('template', template.id)}><span className={`template-thumb ${template.id}`} aria-hidden="true">{[0,1,2,3,4,5].map(n => <i key={n}/>)}</span><span>{template.name}</span>{settings.template === template.id && <Check size={13} className="template-check"/>}</button>)}</div>
              <div className="field-group palette-group"><label>Choose a background <span>{colors.find(c => c.value === settings.background)?.name}</span></label><div className="palette">{colors.map(color => <button key={color.value} className={`swatch ${settings.background === color.value ? 'selected' : ''}`} style={{ background: color.value }} aria-label={`${color.name} background`} aria-pressed={settings.background === color.value} onClick={() => update('background', color.value)}>{settings.background === color.value && <Check size={15}/>}</button>)}</div></div>
              <div className="toggle-row"><div><label htmlFor="captions">Show GIF captions</label><p>Because the face needs a footnote</p></div><button id="captions" className={`toggle ${settings.captions ? 'on' : ''}`} role="switch" aria-checked={settings.captions} aria-label="Show captions" onClick={() => update('captions', !settings.captions)}><span/></button></div>
              <div className="style-note"><Bow/><p>They gave you the material.<br/><em>You gave it a colour palette.</em></p></div>
              <button className="next-step" onClick={() => setTab('content')}><ArrowLeft size={15}/> Back to your GIFs</button>
            </>}
          </div>
          <div className="local-note"><Heart size={12}/><span>{draftState === 'saving' ? 'Saving your draft on this device…' : draftState === 'saved' ? 'Draft saved on this device. The lore is safe.' : 'Draft could not be saved. Download a backup before leaving.'}</span></div>
        </aside>
        <div className="preview-panel">
          <div className="preview-toolbar"><span className="preview-label"><span/> LIVE PREVIEW</span><div className="preview-tools"><div className="device-picker" aria-label="Preview size"><button aria-label="Desktop preview" aria-pressed={!phone} className={!phone ? 'active' : ''} onClick={() => setPhone(false)}><Monitor size={15}/></button><button aria-label="Phone preview" aria-pressed={phone} className={phone ? 'active' : ''} onClick={() => setPhone(true)}><Smartphone size={15}/></button></div><span className="toolbar-divider"/><button className="icon-button" aria-label="Open full preview" onClick={() => setModal('preview')}><Maximize2 size={15}/></button></div></div>
          <div className={`preview-stage ${phone ? 'phone-stage' : ''}`}><div className={`preview-window ${phone ? 'phone-window' : ''}`}><div className="browser-bar"><div className="browser-dots"><i/><i/><i/></div><span>{isDemo ? 'sample gallery · your friends go here' : 'your GIF gallery · looking suspiciously iconic'}</span><Heart size={10}/></div><Gallery items={shownItems} settings={shownSettings} phone={phone} onOpen={setLightbox} onEditCaption={editCaption}/></div>{isDemo && <span className="demo-label">stunt doubles. your friends are probably funnier. <span aria-hidden="true">↖</span></span>}</div>
          <div className="export-bar"><div><span className="export-flower" aria-hidden="true">✳</span><div><strong>Ready for the group chat?</strong><span>Publish with GitHub or download for Netlify.</span></div></div><button className="primary download" onClick={() => setModal('publish')} disabled={exporting || uploading}><ArrowDownToLine size={16}/>Publish gallery</button></div>
        </div>
      </section>
    </main>
    {notice && <div className="toast" role="status"><Info size={17}/><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice('')}><X size={15}/></button></div>}
    {modal === 'help' && <Modal title="How it works" onClose={() => setModal(null)}><Bow className="modal-bow"/><span className="section-kicker">FROM CAMERA ROLL TO COMEDY GOLD</span><h2>Make your friend group’s GIF gallery.</h2><ol className="help-steps"><li><span>01</span><div><h3>Upload the evidence</h3><p>Choose GIFs, WebP stickers, PNGs or JPGs. Add a whole folder, or a few at a time. Up to 60 images, 20 MB each and 150 MB total.</p></div></li><li><span>02</span><div><h3>Caption the chaos</h3><p>Name your gallery, then tap Add caption or Edit caption on each GIF. Add the punchline, drag them into order, and pick a cute layout.</p></div></li><li><span>03</span><div><h3>Release it into the group chat</h3><p>Choose Publish with GitHub to connect your account and publish from here. Or download your website ZIP, unzip it and drop the folder into Netlify Drop. Netlify may ask you to sign in and make the site public.</p></div></li></ol><div className="help-note">Your draft saves on this device. GitHub publishing creates a public repository and page in your account; it can take up to 10 minutes. ZIP export includes everything for offline viewing or Netlify.</div><button className="primary full" onClick={() => setModal(null)}>Let’s immortalise some nonsense <ArrowRight size={16}/></button></Modal>}
    {modal === 'publish' && <Modal title="Publish your gallery" className="publish-modal" onClose={() => setModal(null)}><PublishPanel items={items} settings={settings} publication={publication} onPublished={setPublication} onLoad={(loaded, nextSettings, nextPublication) => { objectUrls.current.forEach(url => URL.revokeObjectURL(url)); objectUrls.current.clear(); loaded.forEach(item => objectUrls.current.add(item.url)); setItems(loaded); setSettings(nextSettings); setPublication(nextPublication); setModal(null); setNotice('Your published gallery is open. Give the lore an update.'); }} onDownload={download} exporting={exporting}/></Modal>}
    {modal === 'preview' && <Modal title="Full gallery preview" className="preview-modal" onClose={() => setModal(null)}><Gallery items={shownItems} settings={shownSettings} onOpen={setLightbox}/></Modal>}
    {activeImage && <Modal title="Image viewer" className="lightbox" onClose={() => setLightbox(null)}><img src={activeImage.url} alt={activeImage.caption || activeImage.name}/><div className="lightbox-bottom"><button className="icon-button" aria-label="Previous image" onClick={() => setLightbox(current => (current! - 1 + shownItems.length) % shownItems.length)}><ArrowLeft size={20}/></button><div><p>{activeImage.caption || activeImage.name}</p><span>{lightbox! + 1} / {shownItems.length}</span></div><button className="icon-button" aria-label="Next image" onClick={() => setLightbox(current => (current! + 1) % shownItems.length)}><ArrowRight size={20}/></button></div></Modal>}
    {captionItem && <Modal title="Edit GIF caption" className="caption-modal" onClose={() => setEditingCaption(null)}><span className="section-kicker">EVERY GIF DESERVES A PUNCHLINE</span><h2>Tell us what happened.</h2><img className="caption-preview" src={captionItem.url} alt={captionItem.name}/><form onSubmit={event => { event.preventDefault(); saveCaption(); }}><div className="field-group"><label htmlFor="caption-draft">Your caption <span>{captionDraft.length}/100</span></label><textarea id="caption-draft" autoFocus rows={3} maxLength={100} value={captionDraft} onChange={event => setCaptionDraft(event.target.value)} placeholder="When he says ‘I know a shortcut’ for the third time."/></div><p className="caption-dialog-hint">Inside jokes encouraged. Leaving it blank removes the caption.</p>{!settings.captions && <div className="caption-hidden-note">Captions are hidden in your gallery. <button type="button" onClick={() => update('captions', true)}>Show captions</button></div>}<div className="caption-actions"><button type="button" className="secondary" onClick={() => setEditingCaption(null)}>Cancel</button><button type="submit" className="primary"><Check size={15}/> Save caption</button></div></form></Modal>}
  </>;
}
