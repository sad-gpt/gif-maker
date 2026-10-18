import { digest, base64 } from './bytes';
type Session = { user?: { id: number; login: string } };

import { ApiError, GitHub } from './github';
import { Store } from './store';
import type { PublishInput } from './validation';

export type Job = { id: string; userId: number; owner: string; input: PublishInput; repoId?: number; branch?: string; baseCommit?: string; commit?: string; tree?: string; pushed?: boolean; blobs: Record<string, string>; status: 'creating' | 'uploading' | 'publishing' | 'live' | 'failed'; url?: string; created: number; updated: number; lastPoll?: number; error?: string };
export type GalleryRecord = { repoId: number; userId: number; owner: string; name: string; branch: string; commit: string; manifest: PublishInput['manifest']; files: { path: string; sha: string; size: number }[]; url?: string; updated: number };
export class Publisher {
  private locks = new Set<string>();
  constructor(private store: Store, private gh: GitHub) {}
  async lock<T>(key: string, operation: () => Promise<T>) {
    if (this.locks.has(key)) throw new ApiError(409, 'This publishing step is already running. Wait a moment, then retry.', 3);
    this.locks.add(key); try { return await operation(); } finally { this.locks.delete(key); }
  }
  save(job: Job) { job.updated = Date.now(); this.store.put('jobs', job.id, job, Date.now() + 7 * 86400000); }
  job(id: string, userId: number) {
    const job = this.store.get<Job>('jobs', id);
    if (!job || job.userId !== userId) throw new ApiError(404, 'This publish session is no longer available. Start publishing again.');
    return job;
  }
  view(job: Job) { return { id: job.id, name: job.input.name, repoId: job.repoId, owner: job.owner, status: job.status, uploaded: Object.keys(job.blobs), url: job.url, repositoryUrl: `https://github.com/${job.owner}/${job.input.name}`, error: job.error }; }
  record(repoId: number, userId: number) {
    const record = this.store.get<GalleryRecord>('galleries', String(repoId));
    if (!record || record.userId !== userId) throw new ApiError(404, 'Only galleries created through this app can be edited here.');
    return record;
  }
  async start(session: Session, token: string, input: PublishInput) {
    return this.lock(`user:${session.user!.id}`, async () => {
      const userId = session.user!.id;
      let job = this.store.all<Job>('jobs').find(job => job.userId === userId && job.input.key === input.key);
      if (job && JSON.stringify(job.input) !== JSON.stringify(input)) throw new ApiError(409, 'The gallery changed. Start a fresh publish to include your edits.');
      if (!job) {
        const active = this.store.all<Job>('jobs').find(job => job.userId === userId && job.updated > Date.now() - 30 * 60000 && ['creating', 'uploading'].includes(job.status));
        if (active) throw new ApiError(409, 'Another gallery upload is active. Resume it or wait 30 minutes before starting another.');
        const recent = this.store.all<Job>('jobs').filter(job => job.userId === userId && job.created > Date.now() - 3600000);
        if (recent.length >= 8) throw new ApiError(429, 'You’ve started 8 publishes this hour. Take a little break before the next one.', 3600);
        job = { id: crypto.randomUUID(), userId, owner: session.user!.login, input, blobs: {}, status: 'creating', created: Date.now(), updated: Date.now() };
        if (input.repoId) {
          const record = this.record(input.repoId, userId);
          if (record.name !== input.name || record.owner !== job.owner) throw new ApiError(409, 'The saved gallery does not match this repository.');
          job.repoId = record.repoId; job.branch = record.branch;
        }
        this.save(job);
      }
      if (job.baseCommit) return this.view(job);
      const base = `/repos/${encodeURIComponent(job.owner)}/${encodeURIComponent(input.name)}`;
      if (!job.repoId) {
        // Reconcile an interrupted create before retrying the non-idempotent POST.
        const marker = `A GIF gallery made with gif & giggles. Publish ID: ${job.id}`;
        let repo: { id: number; default_branch: string; description: string; owner: { id: number }; private: boolean } | undefined;
        try { repo = await this.gh.request(token, base); } catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error; }
        if (repo && repo.description !== marker) throw new ApiError(409, 'That repository name is already taken. Choose a different page name.');
        if (!repo) repo = await this.gh.request(token, '/user/repos', 'POST', { name: input.name, description: marker, private: false, auto_init: true, has_issues: false, has_projects: false, has_wiki: false });
        if (!repo || repo.owner.id !== userId || repo.private) throw new ApiError(403, 'The repository owner or visibility did not match. Publishing stopped.');
        job.repoId = repo.id; job.branch = repo.default_branch; this.save(job);
      } else {
        const repo = await this.gh.request<{ id: number; private: boolean; owner: { id: number } }>(token, base);
        if (repo.id !== job.repoId || repo.owner.id !== userId || repo.private) throw new ApiError(409, 'This repository changed ownership or visibility. Publishing stopped.');
      }
      const ref = await this.gh.request<{ object: { sha: string } }>(token, `${base}/git/ref/heads/${encodeURIComponent(job.branch!)}`);
      if (input.repoId && this.record(input.repoId, userId).commit !== ref.object.sha) throw new ApiError(409, 'This repository was edited outside the app. Publish a new gallery to avoid overwriting those changes.');
      job.baseCommit = ref.object.sha; job.status = 'uploading'; this.save(job);
      return this.view(job);
    });
  }
  async upload(job: Job, token: string, index: number, body: Uint8Array) {
    return this.lock(job.id, async () => {
      const expected = job.input.files[index];
      if (!expected || !job.repoId || !job.baseCommit) throw new ApiError(400, 'Invalid upload step.');
      if (body.length !== expected.size || await digest(body) !== expected.digest) throw new ApiError(400, 'This file changed since publishing started. Please start again.');
      if (job.blobs[expected.path]) return this.view(job);
      if (job.status !== 'uploading') throw new ApiError(409, 'This gallery is no longer accepting files.');
      const result = await this.gh.request<{ sha: string }>(token, `/repos/${job.owner}/${job.input.name}/git/blobs`, 'POST', { content: base64(body), encoding: 'base64' });
      job.blobs[expected.path] = result.sha; this.save(job);
      return this.view(job);
    });
  }
  async finish(job: Job, token: string) {
    return this.lock(job.id, async () => {
      if (job.status === 'live') return this.view(job);
      if (job.input.files.some(file => !job.blobs[file.path])) throw new ApiError(400, 'Some gallery files are still missing. Resume the upload.');
      const base = `/repos/${job.owner}/${job.input.name}`;
      const refPath = `${base}/git/ref/heads/${encodeURIComponent(job.branch!)}`;
      if (!job.tree) {
        const result = await this.gh.request<{ sha: string }>(token, `${base}/git/trees`, 'POST', { tree: job.input.files.map(file => ({ path: file.path, mode: '100644', type: 'blob', sha: job.blobs[file.path] })) });
        job.tree = result.sha; this.save(job);
      }
      if (!job.commit) {
        const result = await this.gh.request<{ sha: string }>(token, `${base}/git/commits`, 'POST', { message: 'Publish gallery with gif & giggles', tree: job.tree, parents: [job.baseCommit] });
        job.commit = result.sha; this.save(job);
      }
      const ref = await this.gh.request<{ object: { sha: string } }>(token, refPath);
      if (ref.object.sha !== job.commit) {
        if (ref.object.sha !== job.baseCommit) throw new ApiError(409, 'The repository changed during publishing. Your changes were not overwritten. Publish a new gallery instead.');
        await this.gh.request(token, `${base}/git/refs/heads/${encodeURIComponent(job.branch!)}`, 'PATCH', { sha: job.commit, force: false });
      }
      job.pushed = true; this.save(job);
      let pages: { html_url: string; source?: { branch: string; path: string } } | undefined;
      try { pages = await this.gh.request(token, `${base}/pages`); } catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error; }
      if (!pages) pages = await this.gh.request(token, `${base}/pages`, 'POST', { build_type: 'legacy', source: { branch: job.branch, path: '/' } });
      else if (pages.source?.branch !== job.branch || pages.source?.path !== '/') throw new ApiError(409, 'Pages settings were changed outside the app. Restore branch publishing from the gallery branch root, then retry.');
      if (!pages) throw new ApiError(502, 'GitHub Pages did not return a site address. Please retry.');
      const url = new URL(pages.html_url);
      if (url.protocol !== 'https:') url.protocol = 'https:';
      job.url = url.href; job.status = 'publishing'; this.save(job);
      const record: GalleryRecord = { repoId: job.repoId!, userId: job.userId, owner: job.owner, name: job.input.name, branch: job.branch!, commit: job.commit, manifest: job.input.manifest, files: job.input.files.map(file => ({ path: file.path, sha: job.blobs[file.path], size: file.size })), url: job.url, updated: Date.now() };
      this.store.put('galleries', String(record.repoId), record);
      return this.view(job);
    });
  }
  async status(job: Job, token: string) {
    if (job.status !== 'publishing' || (job.lastPoll && Date.now() - job.lastPoll < 15000)) return this.view(job);
    return this.lock(`poll:${job.id}`, async () => {
      job.lastPoll = Date.now(); this.save(job);
      let build: { status: string; commit: string; error?: { message: string | null } };
      try { build = await this.gh.request(token, `/repos/${job.owner}/${job.input.name}/pages/builds/latest`); } catch (error) { if (error instanceof ApiError && error.status === 404) return this.view(job); throw error; }
      if (build.commit !== job.commit) return this.view(job);
      if (build.status === 'built') job.status = 'live';
      if (build.status === 'errored') { job.status = 'failed'; job.error = 'GitHub Pages could not build this gallery. Check the repository’s Pages build, then retry publishing.'; }
      this.save(job); return this.view(job);
    });
  }
}
