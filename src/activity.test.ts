import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { recordActivity } from './activity';
import { seal } from './auth/session';
const origin = 'https://example.com';
const id = '11111111-1111-4111-8111-111111111111';
function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`${origin}/api/activity`, { method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('APP_ORIGIN', origin); vi.stubEnv('SESSION_SECRET', 'a'.repeat(40));
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.com'); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'private-token');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('ignores preview deployments without contacting storage', async () => {
  vi.stubEnv('VERCEL_ENV', 'preview'); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  expect((await recordActivity(request({ type: 'zip_export', id }))).status).toBe(204);
  expect(fetcher).not.toHaveBeenCalled();
});
it('rejects cross-origin, oversized and invalid events', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  expect((await recordActivity(request({ type: 'zip_export', id }, { origin: 'https://other.com' }))).status).toBe(403);
  expect((await recordActivity(request({ type: 'zip_export', id, caption: 'private' }))).status).toBe(400);
  expect((await recordActivity(request({ text: 'a'.repeat(600) }))).status).toBe(413);
  expect(fetcher).not.toHaveBeenCalled();
});
it('counts ZIP events through atomic deduplication without sending content', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ result: 1 })).mockResolvedValueOnce(Response.json({ result: 0 })).mockResolvedValueOnce(Response.json({ result: 1 })); vi.stubGlobal('fetch', fetcher);
  expect((await recordActivity(request({ type: 'zip_export', id }))).status).toBe(204);
  const command = JSON.parse(fetcher.mock.calls[2][1].body);
  expect(command[0]).toBe('EVAL'); expect(command).toContain('gg:activity:totals'); expect(command.at(-1)).toBe('zip_exports');
  expect(JSON.stringify(command)).not.toContain(id);
});
it('skips duplicate events and rate limits requests', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ result: 1 })).mockResolvedValueOnce(Response.json({ result: 1 })); vi.stubGlobal('fetch', fetcher);
  expect((await recordActivity(request({ type: 'zip_export', id }))).status).toBe(204); expect(fetcher).toHaveBeenCalledTimes(2);
  fetcher.mockReset().mockResolvedValue(Response.json({ result: 61 }));
  expect((await recordActivity(request({ type: 'zip_export', id }))).status).toBe(429); expect(fetcher).toHaveBeenCalledTimes(1);
});
it('requires authentication and verifies ownership before counting GitHub', async () => {
  const event = { type: 'github_publish', id, repoId: 123, update: false };
  expect((await recordActivity(request(event))).status).toBe(401);
  const token = seal({ expires: Date.now() + 60000, csrf: 'csrf', user: { id: 7, login: 'me' }, token: 'github-token' });
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ result: 1 })).mockResolvedValueOnce(Response.json({ result: 0 })).mockResolvedValueOnce(Response.json({ owner: { id: 8 }, private: false })); vi.stubGlobal('fetch', fetcher);
  expect((await recordActivity(request(event, { cookie: `gg_next_session=${token}` }))).status).toBe(403);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it('reports a storage failure without leaking credentials', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private-token')));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const response = await recordActivity(request({ type: 'zip_export', id }));
  expect(response.status).toBe(503); expect(await response.text()).toBe('');
  expect(warn).toHaveBeenCalledWith('Activity counter unavailable'); warn.mockRestore();
});
