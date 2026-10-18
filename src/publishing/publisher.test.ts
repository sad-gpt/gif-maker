import { expect, it, vi } from 'vitest';
import { Store } from './store';
import { GitHub, ApiError } from './github';
import { Publisher } from './publisher';
import { digest } from './bytes';
import { publishSchema } from './validation';
import type { PublishInput } from './validation';
function storage(): Storage {
  const values = new Map<string,string>();
  return { get length() { return values.size; }, key: i => [...values.keys()][i] || null, getItem: key => values.get(key) ?? null, setItem: (key,value) => { values.set(key,value); }, removeItem: key => { values.delete(key); }, clear: () => values.clear() };
}
const user = { id: 7, login: 'me' };
async function fixture() {
  const paths = ['index.html','gallery.json','.nojekyll','fonts/dm-sans.woff2','fonts/lora.woff2','fonts/lora-italic.woff2','START-HERE.txt','images/01.gif'];
  const bytes = paths.map(path => new TextEncoder().encode(path === '.nojekyll' ? '' : path));
  const input: PublishInput = { key: crypto.randomUUID(), name: 'friends', publicConfirmed: true, manifest: { format: 'gif-and-giggles', version: 1, settings: { title: 'Friends', description: '', template: 'grid', background: '#ffffff', captions: true }, items: [{ id: 'one', name: 'one.gif', caption: 'funny', path: 'images/01.gif', extension: 'gif' }] }, files: await Promise.all(paths.map(async (path,i) => ({ path, size: bytes[i].length, digest: await digest(bytes[i]) }))) };
  return { input, bytes };
}
function githubFixture() {
  let repo: unknown, head = 'original', pages = false, failAfterPush = false, buildCommit = '';
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname, method = init?.method || 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (path === '/user/repos') { repo = { id: 101, owner: user, private: false, description: body.description, default_branch: 'main' }; return Response.json(repo); }
    if (path === '/repos/me/friends') return Response.json(repo || {}, { status: repo ? 200 : 404 });
    if (path.endsWith('/git/ref/heads/main')) return Response.json({ object: { sha: head } });
    if (path.endsWith('/git/blobs')) return Response.json({ sha: await digest(new TextEncoder().encode(body.content)) });
    if (path.endsWith('/git/trees')) return Response.json({ sha: 'tree' });
    if (path.endsWith('/git/commits')) return Response.json({ sha: 'published' });
    if (path.endsWith('/git/refs/heads/main')) { head = body.sha; if (failAfterPush) { failAfterPush = false; throw new Error('lost response'); } return Response.json({}); }
    if (path.endsWith('/pages/builds/latest')) return Response.json({ status: 'built', commit: buildCommit || head });
    if (path.endsWith('/pages')) { if (method === 'POST') pages = true; return Response.json(pages ? { html_url: 'https://me.github.io/friends/', source: { branch: 'main', path: '/' } } : {}, { status: pages ? 200 : 404 }); }
    throw new Error(`Unexpected request ${path}`);
  });
  return { fetcher: fetcher as typeof fetch, fail: () => { failAfterPush = true; }, head: (value: string) => { head = value; }, build: (value: string) => { buildCommit = value; } };
}
it('publishes directly to GitHub and resumes checkpoints across publisher instances', async () => {
  const memory = storage(), store = new Store(memory), mock = githubFixture(), gh = new GitHub(store, mock.fetcher, 0);
  let publisher = new Publisher(store, gh);
  const { input, bytes } = await fixture();
  const started = await publisher.start({ user }, 'token', input);
  let job = publisher.job(started.id, user.id);
  await publisher.upload(job, 'token', 0, bytes[0]);
  publisher = new Publisher(new Store(memory), gh); job = publisher.job(started.id, user.id);
  expect(job.blobs['index.html']).toBeTruthy();
  for (let i = 0; i < bytes.length; i++) await publisher.upload(job, 'token', i, bytes[i]);
  mock.fail(); await expect(publisher.finish(job,'token')).rejects.toBeInstanceOf(ApiError);
  await publisher.finish(job,'token');
  mock.build('older'); expect((await publisher.status(job,'token')).status).toBe('publishing');
  job.lastPoll = 0; mock.build('published'); expect((await publisher.status(job,'token')).status).toBe('live');
  expect(publisher.record(101, user.id).manifest.settings.title).toBe('Friends');
});
it('rejects changed bytes, another user, and outside edits before updating the branch', async () => {
  const store = new Store(storage()), mock = githubFixture(), publisher = new Publisher(store, new GitHub(store,mock.fetcher,0));
  const { input, bytes } = await fixture(); const view = await publisher.start({ user },'token',input); const job = publisher.job(view.id,user.id);
  expect(() => publisher.job(view.id,999)).toThrow();
  await expect(publisher.upload(job,'token',0,new Uint8Array([1]))).rejects.toThrow('file changed');
  for (let i=0;i<bytes.length;i++) await publisher.upload(job,'token',i,bytes[i]);
  mock.head('outside-edit'); await expect(publisher.finish(job,'token')).rejects.toThrow('repository changed');
});
it('honours GitHub rate limits without repeatedly sending requests', async () => {
  const fetcher = vi.fn(async () => Response.json({}, {status:429,headers:{'retry-after':'60'}}));
  const gh = new GitHub(new Store(storage()),fetcher,0);
  await expect(gh.request('token','/user')).rejects.toMatchObject({status:429,retryAfter:60});
  await expect(gh.request('token','/user')).rejects.toMatchObject({status:429});
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('rejects unsafe export paths and missing public confirmation', async () => {
  const { input } = await fixture(); expect(publishSchema.safeParse(input).success).toBe(true);
  expect(publishSchema.safeParse({...input,publicConfirmed:false}).success).toBe(false);
  input.files[0].path='../secret'; expect(publishSchema.safeParse(input).success).toBe(false);
});
it('calls fetch without binding it to the GitHub client instance', async () => {
  const fetcher = vi.fn(function (this: unknown) {
    if (this !== undefined) throw new TypeError('Illegal invocation');
    return Promise.resolve(Response.json({ ok: true }));
  });
  const gh = new GitHub(new Store(storage()), fetcher, 0);
  await expect(gh.request('test-token', '/user')).resolves.toEqual({ ok: true });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('identifies failed requests without exposing authorization credentials', async () => {
  const gh = new GitHub(new Store(storage()), async () => { throw new TypeError('Failed to fetch'); }, 0);
  await expect(gh.request('private-token', '/user/repos', 'POST', { private: false })).rejects.toMatchObject({ status: 503, message: expect.stringContaining('POST /user/repos') });
  try { await gh.request('private-token', '/user/repos'); } catch (error) { expect(String(error)).not.toContain('private-token'); }
});
