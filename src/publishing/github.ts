import { digest } from './bytes';
import type { Store } from './store';

export class ApiError extends Error {
  constructor(public status: number, message: string, public retryAfter = 0) { super(message); }
}
export function retryDelay(response: Response, now = Date.now()) {
  const retry = response.headers.get('retry-after');
  if (retry) return Math.max(1, /^\d+$/.test(retry) ? Number(retry) : Math.ceil((Date.parse(retry) - now) / 1000));
  if (response.headers.get('x-ratelimit-remaining') === '0') return Math.max(1, Math.ceil(Number(response.headers.get('x-ratelimit-reset')) - now / 1000));
  return 60;
}
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export class GitHub {
  private queues = new Map<string, Promise<unknown>>();
  private writes = new Map<string, number>();
  constructor(private store: Store, private fetcher: typeof fetch = fetch, private writeSpacing = 1100) {}
  async request<T>(token: string, path: string, method = 'GET', body?: unknown): Promise<T> {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid GitHub API path.');
    const key = await digest(new TextEncoder().encode(token));
    const task = (this.queues.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
      const until = this.store.get<number>('cooldown', key) || 0;
      if (until > Date.now()) throw new ApiError(429, 'GitHub asked us to pause. Your progress is saved; try again after the countdown.', Math.ceil((until - Date.now()) / 1000));
      const mutates = method !== 'GET';
      if (mutates) await pause(Math.max(0, (this.writes.get(key) || 0) + this.writeSpacing - Date.now()));
      if (mutates) this.writes.set(key, Date.now());
      let response: Response;
      try {
        // Native browser fetch must not receive this GitHub instance as its receiver.
        const fetcher = this.fetcher;
        response = await fetcher(`https://api.github.com${path}`, { method, redirect: 'error', headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45000) });
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        // Keep credentials and request bodies out of diagnostics.
        const endpoint = `${method} ${path.split('?')[0]}`;
        throw new ApiError(503, timedOut
          ? `GitHub took too long to respond (${endpoint}). Your progress is saved. Retry when your connection is stable.`
          : `Your browser could not complete the GitHub request (${endpoint}). Your progress is saved. Check the browser Console for a blocked request or connection error, then resume.`, 10);
      }
      const data = response.status === 204 ? {} : await response.json().catch(() => ({})) as { message?: string };
      if (response.status === 429 || (response.status === 403 && (response.headers.has('retry-after') || response.headers.get('x-ratelimit-remaining') === '0' || /rate limit|abuse|secondary/i.test(data.message || '')))) {
        const seconds = retryDelay(response);
        this.store.put('cooldown', key, Date.now() + seconds * 1000, Date.now() + seconds * 1000);
        throw new ApiError(429, 'GitHub is taking a breather. Your progress is saved; retry after the countdown.', seconds);
      }
      if (!response.ok) {
        if (response.status === 401) throw new ApiError(401, 'Your GitHub connection expired. Connect again to continue.');
        if (response.status === 403) throw new ApiError(403, 'GitHub denied this request. Check the app’s repository permissions and your account access.');
        if (response.status === 404) throw new ApiError(404, 'This GitHub resource is unavailable. Check repository access.');
        throw new ApiError(response.status >= 500 ? 503 : response.status, response.status === 422 ? 'GitHub could not accept this change. The name may already be taken, or your account may need verification.' : 'GitHub could not complete this request. Please retry.');
      }
      return data as T;
    });
    this.queues.set(key, task);
    try { return await task; } finally { if (this.queues.get(key) === task) { this.queues.delete(key); setTimeout(() => { if (!this.queues.has(key)) this.writes.delete(key); }, this.writeSpacing + 100); } }
  }
}
