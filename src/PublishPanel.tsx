import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Check, CheckCircle2, Copy, ExternalLink, Github, LoaderCircle, LogOut, RefreshCw, UploadCloud } from 'lucide-react';
import { api, post, RequestError } from './api';
import { startPublish, uploadFile, finishPublish, publishStatus, abandonPublish, listGalleries as fetchGalleries, loadGalleryRecord, loadGalleryImage, clearCredential } from './publishing/client';
import type { PublishJob, UserSession } from './api';
import { createGalleryFiles, describeFiles } from './gallery';
import type { GalleryManifest } from './gallery';
import { readLocal, saveDraft, writeLocal } from './draft';
import type { Publication } from './draft';
import type { GalleryItem, GallerySettings } from './types';

type Input = { key: string; name: string; repoId?: number; publicConfirmed: true; manifest: GalleryManifest; files: Awaited<ReturnType<typeof describeFiles>> };
type Pending = { input: Input; userId: number; job?: PublishJob };
type SavedGallery = Publication & { title: string; updated: number };
const slugify = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 58).replace(/-$/, '') || 'our-gif-gallery';
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export default function PublishPanel({ items, settings, publication, onPublished, onLoad, onDownload, exporting }: { items: GalleryItem[]; settings: GallerySettings; publication?: Publication; onPublished: (publication: Publication) => void; onLoad: (items: GalleryItem[], settings: GallerySettings, publication: Publication) => void; onDownload: () => Promise<boolean>; exporting: boolean }) {
  const [session, setSession] = useState<UserSession | null>(null);
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [job, setJob] = useState<PublishJob | null>(null);
  const [name, setName] = useState(publication?.name || slugify(settings.title));
  const [mode, setMode] = useState<'new' | 'update'>(publication ? 'update' : 'new');
  const [confirmed, setConfirmed] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const [galleries, setGalleries] = useState<SavedGallery[] | null>(null);
  const [replaceDraft, setReplaceDraft] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const alive = useRef(true);
  const running = useRef(false);
  const popup = useRef<Window | null>(null);
  const pollingStarted = useRef(Date.now());
  const remaining = Math.max(0, Math.ceil((retryAt - now) / 1000));

  async function refreshSession() {
    const value = await api<UserSession>('/api/session');
    if (alive.current) { setSession(value); }
    return value;
  }
  async function retryConnection() {
    setError('');
    try { await refreshSession(); }
    catch (error) { if (alive.current) setError(error instanceof Error ? error.message : 'Connection unavailable. Please retry.'); }
  }
  useEffect(() => {
    if (session) return;
    const recover = () => { void retryConnection(); };
    window.addEventListener('online', recover);
    window.addEventListener('focus', recover);
    return () => { window.removeEventListener('online', recover); window.removeEventListener('focus', recover); };
  }, [session]);
  useEffect(() => {
    let cancelled = false;
    if (session?.user) void readLocal<Pending | null>('pending-publish').then(stored => {
      if (!cancelled && stored && stored.userId === session.user?.id) { setPending(stored); setJob(stored.job || null); setName(stored.input.name); setConfirmed(true); }
    }).catch(() => setError('Your saved publishing progress could not be opened.'));
    return () => { cancelled = true; };
  }, [session?.user?.id]);
  useEffect(() => {
    alive.current = true;
    void (async () => {
      try {
        const value = await refreshSession();
        const stored = await readLocal<Pending | null>('pending-publish');
        if (alive.current && stored && value.user?.id === stored.userId) { setPending(stored); setJob(stored.job || null); setName(stored.input.name); setConfirmed(true); }
      } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : 'Publishing is unavailable right now.'); }
    })();
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== popup.current || event.data?.type !== 'github-connected') return;
      setConnecting(false);
      if (event.data.error) setError(event.data.error);
      else { clearCredential(); void retryConnection(); }
    };
    window.addEventListener('message', receive);
    return () => { alive.current = false; window.clearInterval(timer); window.removeEventListener('message', receive); };
  }, []);
  useEffect(() => {
    if (!connecting) return;
    const timer = window.setInterval(() => { if (popup.current?.closed) { setConnecting(false); void refreshSession().catch(() => {}); } }, 800);
    return () => window.clearInterval(timer);
  }, [connecting]);
  async function connect(install = false) {
    setError('');
    const windowRef = window.open('about:blank', 'gif-giggles-github', 'popup,width=620,height=760');
    if (!windowRef) { setError('Allow popups for this website, then try connecting again.'); return; }
    popup.current = windowRef;
    setConnecting(true);
    try {
      await saveDraft(items, settings, publication);
      windowRef.location.href = install ? '/api/auth/github/install' : '/api/auth/github/start';
    } catch { windowRef.close(); setConnecting(false); setError('Your draft could not be saved on this device. Download a backup before connecting GitHub.'); }
  }
  async function remember(next: Pending) { await writeLocal('pending-publish', next); if (alive.current) { setPending(next); setJob(next.job || null); } }
  async function step<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      if (!alive.current) throw new Error('Publishing paused. Reopen this panel to resume.');
      try { return await operation(); }
      catch (error) {
        if (error instanceof RequestError && error.retryAfter) {
          setRetryAt(Date.now() + error.retryAfter * 1000);
          if (attempt < 2 && error.retryAfter <= 60) { setStage(`Waiting for GitHub — retrying in ${error.retryAfter}s`); await wait(error.retryAfter * 1000); continue; }
        }
        throw error;
      }
    }
  }
  async function publish() {
    if (!session?.user || running.current || !items.length || !confirmed || remaining) return;
    running.current = true; setBusy(true); setError('');
    try {
      await saveDraft(items, settings, publication);
      const fresh = await refreshSession();
      if (!fresh.user || !fresh.installed) throw new Error('Connect GitHub and allow gallery publishing first.');
      setStage('Packing the GIFs, captions and fonts…');
      const bundle = await createGalleryFiles(items, settings);
      const files = await describeFiles(bundle.files);
      let progress = pending;
      if (progress && progress.userId !== fresh.user.id) throw new Error('This upload belongs to another GitHub account. Start a new publish.');
      if (progress && (JSON.stringify(progress.input.files) !== JSON.stringify(files) || JSON.stringify(progress.input.manifest) !== JSON.stringify(bundle.manifest))) throw new Error('Your draft has changed since the last attempt. Choose “Start a fresh publish” to include the edits.');
      if (!progress) {
        progress = { userId: fresh.user.id, input: { key: crypto.randomUUID(), name, repoId: mode === 'update' ? publication?.repoId : undefined, publicConfirmed: true, manifest: bundle.manifest, files } };
        await remember(progress);
      }
      setStage(mode === 'update' ? 'Opening your gallery repository…' : 'Creating your gallery repository…');
      let current = await step(() => startPublish(progress!.input));
      progress = { ...progress, job: current }; await remember(progress);
      if (current.status === 'uploading') {
        for (let index = 0; index < bundle.files.length; index++) {
          const file = bundle.files[index];
          if (current.uploaded.includes(file.path)) continue;
          setStage(`Uploading gallery files · ${index + 1} of ${bundle.files.length}`);
          current = await step(() => uploadFile(current.id, index, file.blob));
          progress = { ...progress, job: current }; await remember(progress);
        }
      }
      if (current.status !== 'live') {
        setStage('Asking GitHub Pages to put the kettle on…');
        current = await step(() => finishPublish(current.id));
        progress = { ...progress, job: current }; await remember(progress);
      }
      pollingStarted.current = Date.now(); setMode('update'); setName(current.name);
      if (current.repoId) onPublished({ repoId: current.repoId, owner: current.owner, name: current.name, url: current.url });
      setStage('GitHub Pages is publishing your gallery. This can take up to 10 minutes.');
    } catch (error) { if (alive.current) { setError(error instanceof Error ? error.message : 'Publishing paused. Please retry.'); if (error instanceof RequestError && error.status === 401) void refreshSession().catch(() => {}); } }
    finally { running.current = false; if (alive.current) setBusy(false); }
  }
  async function checkStatus() {
    if (!job || remaining || running.current) return;
    try {
      const status = await publishStatus(job.id);
      if (!alive.current) return;
      setJob(status);
      if (pending) await remember({ ...pending, job: status });
      if (status.status === 'live') { setError(''); if (status.repoId) onPublished({ repoId: status.repoId, owner: status.owner, name: status.name, url: status.url }); }
      if (status.status === 'failed') setError(status.error || 'GitHub Pages could not publish this gallery.');
    } catch (error) { if (alive.current) { setError(error instanceof Error ? error.message : 'Could not check publishing status.'); if (error instanceof RequestError && error.retryAfter) setRetryAt(Date.now() + error.retryAfter * 1000); } }
  }
  useEffect(() => {
    if (job?.status !== 'publishing') return;
    const timer = window.setInterval(() => { if (Date.now() - pollingStarted.current < 10 * 60000) void checkStatus(); }, 16000);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status, remaining, pending]);
  async function reset() {
    if (pending && session) await abandonPublish(pending.input.key);
    await writeLocal('pending-publish', null); setPending(null); setJob(null); setError(''); setStage(''); setConfirmed(false);
  }
  async function listGalleries() {
    setError('');
    try { setGalleries(await fetchGalleries()); } catch (error) { setError((error as Error).message); }
  }
  async function downloadForNetlify() {
    const nextWindow = window.open('about:blank', '_blank');
    if (nextWindow) { nextWindow.opener = null; nextWindow.document.title = 'Preparing your gallery'; nextWindow.document.body.textContent = 'Wrapping up your GIF gallery. Netlify Drop will open when the ZIP is ready…'; }
    try {
      if (await onDownload()) { setDownloaded(true); if (nextWindow) nextWindow.location.replace('https://app.netlify.com/drop'); }
      else nextWindow?.close();
    } catch { nextWindow?.close(); setError('The ZIP could not be downloaded. Please try again.'); }
  }
  async function loadGallery(repoId: number) {
    if (items.length && !replaceDraft) return;
    setBusy(true); setError('');
    const urls: string[] = [];
    try {
      const record = await loadGalleryRecord(repoId);
      const loaded: GalleryItem[] = [];
      for (let i = 0; i < record.manifest.items.length; i++) {
        setStage(`Opening saved gallery · ${i + 1} of ${record.manifest.items.length}`);
        const blob = await loadGalleryImage(record, i); const url = URL.createObjectURL(blob); urls.push(url);
        loaded.push({ ...record.manifest.items[i], blob, url });
      }
      await reset();
      const next = { repoId, name: record.name, owner: record.owner, url: record.url };
      await saveDraft(loaded, record.manifest.settings, next);
      onLoad(loaded, record.manifest.settings, next);
    } catch (error) { urls.forEach(url => URL.revokeObjectURL(url)); setError((error as Error).message); }
    finally { if (alive.current) setBusy(false); }
  }
  return <div className="publish-content">
    <span className="section-kicker">THE GROUP CHAT IS WAITING</span><h2>Give the lore a link.</h2><p className="modal-description">Two ways to put your GIF gallery on the internet. Pick your flavour.</p>
    <section className="publish-option github-option"><div className="publish-option-heading"><Github size={23}/><div><h3>Publish with GitHub</h3><p>Your gallery. Your repository. Your link.</p></div><span className="option-tag">Guided</span></div>
      {!session && !error && <p className="publish-status"><LoaderCircle className="spin" size={15}/> Checking your connection…</p>}
      {session && !session.configured && <div className="setup-note">GitHub publishing is being set up. You can download and publish with Netlify below.</div>}
      {session?.configured && !session.user && <><p className="option-explainer">Connect your account, choose a page name, and we’ll create the repository and publish it with GitHub Pages.</p><button className="primary full" disabled={connecting || busy} onClick={() => void connect()}><Github size={16}/>{connecting ? 'Complete sign-in in the GitHub window…' : 'Connect GitHub'}</button></>}
      {session?.user && <>
        <div className="connection-row"><span><CheckCircle2 size={14}/> Connected as <strong>@{session.user.login}</strong></span><button className="icon-button" title="Disconnect GitHub" aria-label="Disconnect GitHub" disabled={busy} onClick={async () => { await post('/api/logout', {}, session.csrf); clearCredential(); setPending(null); setJob(null); setGalleries(null); await refreshSession(); }}><LogOut size={14}/></button></div>
        {!session.installed ? <><p className="option-explainer">One more step: allow gif & giggles to create and publish galleries on your personal GitHub account. Choose selected repositories to keep access narrow.</p><button className="primary full" disabled={connecting} onClick={() => void connect(true)}>Allow gallery publishing <ArrowRight size={15}/></button></> : <>
          {!job || !['live', 'publishing'].includes(job.status) ? <>
            {publication && !pending && <div className="publish-mode"><button className={mode === 'update' ? 'selected' : ''} onClick={() => { setMode('update'); setName(publication.name); }}>Update this gallery</button><button className={mode === 'new' ? 'selected' : ''} onClick={() => { setMode('new'); setName(`${slugify(settings.title).slice(0,53)}-new`); }}>Create a new one</button></div>}
            <div className="field-group"><label htmlFor="page-name">Page name</label><input id="page-name" value={name} disabled={busy || Boolean(pending) || mode === 'update'} maxLength={60} onChange={event => setName(event.target.value.toLowerCase())} placeholder="rahuls-greatest-hits"/><p className="url-preview">{session.user.login}.github.io/{name || 'your-gallery'}/</p></div>
            <label className="public-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)}/><span>I understand this gallery and its GIFs will be public on GitHub.</span></label>
            <button className="primary full" disabled={busy || !confirmed || !items.length || remaining > 0 || !/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(name)} onClick={() => void publish()}>{busy ? <LoaderCircle className="spin" size={16}/> : <UploadCloud size={16}/>} {busy ? 'Publishing…' : pending ? 'Resume publishing' : mode === 'update' ? 'Publish changes' : 'Publish gallery'}</button>
          </> : job.status === 'publishing' ? <div className="publishing-wait"><LoaderCircle className="spin" size={25}/><h3>The GIFs are getting dressed.</h3><p>GitHub Pages is publishing your gallery. This can take up to 10 minutes. You can close this panel and check back.</p><button className="secondary" disabled={remaining > 0} onClick={() => void checkStatus()}><RefreshCw size={13}/> Check status</button><a href={job.repositoryUrl} target="_blank" rel="noopener noreferrer">View repository <ExternalLink size={12}/></a></div> : <div className="publish-success"><CheckCircle2 size={28}/><h3>Your friends are officially a website.</h3><a className="live-url" href={job.url} target="_blank" rel="noopener noreferrer">{job.url}</a><div><button className="primary" onClick={async () => { try { await navigator.clipboard.writeText(job.url!); setCopied(true); } catch { setError('Copy the link shown above manually.'); } }}>{copied ? <Check size={15}/> : <Copy size={15}/>} {copied ? 'Copied!' : 'Copy link'}</button><a className="secondary" href={job.url} target="_blank" rel="noopener noreferrer">Open gallery <ExternalLink size={13}/></a></div></div>}
          {busy && <p className="publish-status" role="status">{stage}</p>}
          {pending && !busy && <button className="text-button" onClick={() => void reset().catch(error => setError(error.message))}>{job?.status === 'live' ? 'Ready to publish more edits?' : 'Start a fresh publish'}</button>}
          <button className="text-button" disabled={busy} onClick={() => void listGalleries()}>Open one of my published galleries</button>
        </>}
      </>}
      {error && <div className="publish-error" role="alert">{error}{remaining > 0 && <span>Try again in {remaining}s.</span>}</div>}
      {!session && error && <button className="primary full" onClick={() => void retryConnection()}><RefreshCw size={16}/> Retry connection</button>}
      {galleries && <div className="saved-galleries"><h4>Your published galleries</h4>{items.length > 0 && <label className="public-confirm"><input type="checkbox" checked={replaceDraft} onChange={event => setReplaceDraft(event.target.checked)}/><span>Replace my current draft when opening a gallery. Download it first if you want to keep both.</span></label>}{galleries.length ? galleries.map(gallery => <button key={gallery.repoId} disabled={busy || (items.length > 0 && !replaceDraft)} onClick={() => void loadGallery(gallery.repoId)}><span>{gallery.title}<small>{gallery.name}</small></span><ArrowRight size={14}/></button>) : <p>Your first hall of fame is still to come.</p>}</div>}
    </section>
    <div className="publish-or"><span/>or keep it hands-on<span/></div>
    <section className="publish-option"><div className="publish-option-heading"><ArrowDownToLine size={23}/><div><h3>Download for Netlify</h3><p>No GitHub account needed.</p></div></div><p className="option-explainer">Download your complete website, unzip it, then drop the folder into Netlify Drop. Netlify may ask you to sign in to claim it and make it public.</p><button className="secondary full" disabled={exporting || busy || !items.length} onClick={() => void downloadForNetlify()}>{exporting ? <LoaderCircle className="spin" size={15}/> : <ArrowDownToLine size={15}/>} {exporting ? 'Wrapping up the nonsense…' : 'Download ZIP & open Netlify'}</button><button className="text-button" disabled={exporting || busy || !items.length} onClick={async () => { if (await onDownload()) setDownloaded(true); }}>Just download the ZIP</button>{downloaded && <div className="netlify-next" role="status"><strong>ZIP downloaded. Next: unzip it.</strong><a className="primary full" href="https://app.netlify.com/drop" target="_blank" rel="noopener noreferrer">Open Netlify Drop <ExternalLink size={14}/></a><small>Drop the folder containing index.html, images and fonts.</small></div>}</section>
    <p className="publish-fineprint">GIFs upload straight from your browser to your GitHub account. Our server handles sign-in only. ZIP export stays on your device.</p>
  </div>;
}
