import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { handle } from './handler';
import { seal, unseal } from './session';
import type { Session } from './session';
beforeEach(() => {
  vi.stubEnv('APP_ORIGIN', 'http://127.0.0.1:5173');
  vi.stubEnv('SESSION_SECRET', 'testing-only-secret-at-least-thirty-two-characters');
  vi.stubEnv('GITHUB_APP_ID', '42'); vi.stubEnv('GITHUB_APP_SLUG', 'test-app');
  vi.stubEnv('GITHUB_CLIENT_ID', 'test-client'); vi.stubEnv('GITHUB_CLIENT_SECRET', 'test-secret');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const req = (path: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`http://127.0.0.1:5173${path}`, init);
it('encrypts session tokens and rejects tampered or expired cookies', () => {
  const encrypted = seal({ token: 'never-persist-in-readable-form', expires: Date.now() + 60000 });
  expect(encrypted).not.toContain('never-persist');
  expect(unseal<Session>(encrypted)?.token).toBe('never-persist-in-readable-form');
  expect(unseal(encrypted.slice(0, 15) + 'xxxx' + encrypted.slice(19))).toBeUndefined();
  expect(unseal(seal({ expires: Date.now() - 1 }))).toBeUndefined();
});
it('exposes credentials only through a same-origin CSRF-protected POST', async () => {
  const value = seal({ csrf: 'csrf', token: 'user-token', user: { id: 7, login: 'me' }, installed: true, expires: Date.now() + 60000 });
  const headers = { cookie: `gg_next_session=${value}`, origin: 'http://127.0.0.1:5173', 'x-csrf-token': 'csrf' };
  const session = await handle(req('/api/session', { headers }));
  expect(await session.text()).not.toContain('user-token');
  expect((await handle(req('/api/auth/github/token', { method: 'POST', headers: { ...headers, origin: 'https://evil.example' } }))).status).toBe(403);
  const response = await handle(req('/api/auth/github/token', { method: 'POST', headers }));
  expect((await response.json()).token).toBe('user-token');
  expect(response.headers.get('cache-control')).toBe('no-store');
});
it('binds OAuth state to an encrypted cookie, uses PKCE and never puts tokens in popup HTML', async () => {
  const start = await handle(req('/api/auth/github/start'));
  const location = new URL(start.headers.get('location')!);
  expect(location.searchParams.get('code_challenge_method')).toBe('S256');
  const pending = start.cookies.get('gg_next_oauth')!.value;
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    if (String(url).includes('/login/oauth/')) return Response.json({ access_token: 'secret-user-token', refresh_token: 'discard-this', expires_in: 28800 });
    if (String(url).includes('/user/installations')) return Response.json({ installations: [{ app_id: 42, account: { id: 7 }, suspended_at: null }] });
    return Response.json({ id: 7, login: 'me' });
  });
  vi.stubGlobal('fetch', fetcher);
  const bad = await handle(req('/api/auth/github/callback?state=wrong&code=code', { headers: { cookie: `gg_next_oauth=${pending}` } }));
  expect(await bad.text()).toContain('try connecting again'); expect(fetcher).not.toHaveBeenCalled();
  const result = await handle(req(`/api/auth/github/callback?state=${location.searchParams.get('state')}&code=code`, { headers: { cookie: `gg_next_oauth=${pending}` } }));
  expect(await result.text()).not.toContain('secret-user-token');
  expect(result.cookies.get('gg_next_oauth')?.value).toBe('');
  const session = unseal<Session>(result.cookies.get('gg_next_session')?.value);
  expect(session?.installed).toBe(true); expect(session?.token).toBe('secret-user-token');
  expect(session).not.toHaveProperty('refresh_token');
});
it('leaves ZIP use available without GitHub configuration', async () => {
  vi.stubEnv('GITHUB_CLIENT_SECRET', '');
  expect((await (await handle(req('/api/session'))).json()).configured).toBe(false);
  expect((await handle(req('/api/auth/github/start'))).status).toBe(503);
});
