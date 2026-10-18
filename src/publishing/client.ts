import { api, post, RequestError } from '../api';
import type { UserSession, PublishJob } from '../api';
import { Store } from './store';
import { GitHub, ApiError } from './github';
import { Publisher } from './publisher';
import type { GalleryRecord, Job } from './publisher';
import { allowedPath, manifestSchema, publishSchema } from './validation';
import { decode64 } from './bytes';

type Credential = { token: string; expires: number; user: { id: number; login: string }; installed: boolean };
type Repository = { id: number; name: string; owner: { id: number; login: string }; private: boolean; description: string | null; default_branch: string; updated_at: string };
let credential: Credential | undefined;
let services: { store: Store; gh: GitHub; publisher: Publisher } | undefined;
const repositories = new Map<number, Repository>();
export function clearCredential() { credential = undefined; repositories.clear(); }
async function context() {
  if (!credential || credential.expires < Date.now() + 60000) {
    const session = await api<UserSession>('/api/session');
    if (!session.user) throw new RequestError('Connect GitHub to continue.', 401);
    credential = await post<Credential>('/api/auth/github/token', {}, session.csrf);
  }
  if (!services) { const store = new Store(), gh = new GitHub(store); services = { store, gh, publisher: new Publisher(store, gh) }; }
  return { ...services, ...credential };
}
async function run<T>(operation: (ctx: Awaited<ReturnType<typeof context>>) => Promise<T>): Promise<T> {
  try { return await operation(await context()); }
  catch (error) {
    if (error instanceof ApiError) { if (error.status === 401) clearCredential(); throw new RequestError(error.message, error.status, error.retryAfter); }
    throw error;
  }
}
async function mutation<T>(operation: (ctx: Awaited<ReturnType<typeof context>>) => Promise<T>) {
  return run(async ctx => {
    if (navigator.locks) return navigator.locks.request(`gif-giggles-publish-${ctx.user.id}`, { ifAvailable: true }, async lock => {
      if (!lock) throw new RequestError('Publishing is running in another tab. Continue there or try again shortly.', 409);
      return operation(ctx);
    });
    return operation(ctx);
  });
}
export const startPublish = (input: unknown) => mutation(ctx => {
  if (!ctx.installed) throw new RequestError('Install the GitHub App on your personal account first.', 403);
  return ctx.publisher.start({ user: ctx.user }, ctx.token, publishSchema.parse(input));
});
export const uploadFile = (id: string, index: number, blob: Blob) => mutation(async ctx => ctx.publisher.upload(ctx.publisher.job(id, ctx.user.id), ctx.token, index, new Uint8Array(await blob.arrayBuffer())));
export const finishPublish = (id: string) => mutation(ctx => ctx.publisher.finish(ctx.publisher.job(id, ctx.user.id), ctx.token));
export const publishStatus = (id: string): Promise<PublishJob> => run(ctx => ctx.publisher.status(ctx.publisher.job(id, ctx.user.id), ctx.token));
export const abandonPublish = (key: string) => mutation(async ctx => {
  const job = ctx.store.all<Job>('jobs').find(job => job.userId === ctx.user.id && job.input.key === key);
  if (job && !job.pushed) { job.status = 'failed'; ctx.publisher.save(job); }
});
export const listGalleries = () => run(async ctx => {
  repositories.clear();
  for (let page = 1; page <= 10; page++) {
    const batch = await ctx.gh.request<Repository[]>(ctx.token, `/user/repos?affiliation=owner&sort=updated&per_page=100&page=${page}`);
    for (const repo of batch) if (!repo.private && repo.owner.id === ctx.user.id && repo.description?.startsWith('A GIF gallery made with gif & giggles. Publish ID: ')) repositories.set(repo.id, repo);
    if (batch.length < 100) break;
  }
  return [...repositories.values()].map(repo => ({ repoId: repo.id, owner: repo.owner.login, name: repo.name, title: repo.name, updated: Date.parse(repo.updated_at) }));
});
export const loadGalleryRecord = (repoId: number) => run(async ctx => {
  const saved = ctx.store.get<GalleryRecord>('galleries', String(repoId));
  const candidate = repositories.get(repoId);
  if ((!saved || saved.userId !== ctx.user.id) && !candidate) throw new RequestError('Open your saved galleries list first.', 404);
  const owner = candidate?.owner.login || saved!.owner, name = candidate?.name || saved!.name;
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const repo = await ctx.gh.request<Repository>(ctx.token, base);
  if (repo.id !== repoId || repo.owner.id !== ctx.user.id || repo.private) throw new RequestError('This repository changed ownership or visibility.', 409);
  const ref = await ctx.gh.request<{ object: { sha: string } }>(ctx.token, `${base}/git/ref/heads/${encodeURIComponent(repo.default_branch)}`);
  if (saved?.userId === ctx.user.id) {
    if (saved.commit !== ref.object.sha) throw new RequestError('This repository was edited outside the app. Its files will not be overwritten.', 409);
    return saved;
  }
  const commit = await ctx.gh.request<{ message: string; tree: { sha: string } }>(ctx.token, `${base}/git/commits/${ref.object.sha}`);
  if (commit.message.trim() !== 'Publish gallery with gif & giggles') throw new RequestError('This repository was edited outside the app.', 409);
  const tree = await ctx.gh.request<{ truncated: boolean; tree: { path: string; type: string; sha: string; size: number }[] }>(ctx.token, `${base}/git/trees/${commit.tree.sha}?recursive=1`);
  const files = tree.tree.filter(file => file.type === 'blob');
  if (tree.truncated || files.length > 70 || files.some(file => !allowedPath(file.path) || file.size > 20 * 1024 * 1024) || files.reduce((sum,file) => sum + file.size,0) > 154 * 1024 * 1024) throw new RequestError('This repository contains files outside a supported gallery.', 409);
  const manifestFile = files.find(file => file.path === 'gallery.json');
  if (!manifestFile || manifestFile.size > 100000) throw new RequestError('The saved gallery is missing its settings.', 400);
  const data = await ctx.gh.request<{ content: string; encoding: string }>(ctx.token, `${base}/git/blobs/${manifestFile.sha}`);
  if (data.encoding !== 'base64') throw new RequestError('The gallery settings could not be read.', 400);
  const manifest = manifestSchema.parse(JSON.parse(new TextDecoder().decode(decode64(data.content))));
  if (manifest.items.some(item => !files.some(file => file.path === item.path))) throw new RequestError('Some gallery images are missing.', 400);
  const pages = await ctx.gh.request<{ html_url: string }>(ctx.token, `${base}/pages`);
  const record: GalleryRecord = { repoId, userId: ctx.user.id, owner, name, branch: repo.default_branch, commit: ref.object.sha, manifest, files: files.map(({path,sha,size}) => ({path,sha,size})), updated: Date.now(), url: pages.html_url };
  ctx.store.put('galleries', String(repoId), record);
  return record;
});
export const loadGalleryImage = (record: GalleryRecord, index: number) => run(async ctx => {
  if (record.userId !== ctx.user.id) throw new RequestError('Reconnect the account that owns this gallery.', 403);
  const item = record.manifest.items[index], file = record.files.find(file => file.path === item?.path);
  if (!file) throw new RequestError('Gallery image missing.', 404);
  const data = await ctx.gh.request<{ content: string; encoding: string }>(ctx.token, `/repos/${record.owner}/${record.name}/git/blobs/${file.sha}`);
  if (data.encoding !== 'base64') throw new RequestError('GitHub returned an unreadable image.', 502);
  const bytes = decode64(data.content);
  if (bytes.length !== file.size) throw new RequestError('The gallery image download was incomplete.', 502);
  const type = ({ svg: 'image/svg+xml', gif: 'image/gif', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' } as Record<string,string>)[item.extension];
  return new Blob([bytes], { type });
});
