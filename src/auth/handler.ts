import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { random, seal, unseal } from './session';
import type { Session } from './session';
const sessionName = 'gg_next_session';
const stateName = 'gg_next_oauth';
function origin() {
  const url = new URL(process.env.APP_ORIGIN || 'http://127.0.0.1:5173');
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:' && !['127.0.0.1','localhost'].includes(url.hostname)) throw new Error('APP_ORIGIN must use HTTPS.');
  return url.origin;
}
const configured = () => Boolean(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_SLUG && process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET && (process.env.SESSION_SECRET?.length || 0) >= 32);
function cookie(response: NextResponse, name: string, value: string, maxAge: number) {
  response.cookies.set(name, value, { httpOnly: true, secure: origin().startsWith('https:'), sameSite: 'lax', path: '/', maxAge });
}
function json(value: unknown, status = 200) { return NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } }); }
async function github<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, cache: 'no-store', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('GitHub could not verify your account. Close this window and connect again.');
  return response.json();
}
function popup(error?: string) {
  const nonce = random();
  const message = JSON.stringify({ type: 'github-connected', error: error || null }).replace(/</g, '\\u003c');
  return new NextResponse(`<!doctype html><html lang="en"><meta charset="utf-8"><title>GitHub connection</title><body><h1>${error ? 'Please try connecting again.' : 'You’re connected.'}</h1><p>Return to your gallery. You can close this window.</p><a href="/">Back to gif &amp; giggles</a><script nonce="${nonce}">if(window.opener){window.opener.postMessage(${message},${JSON.stringify(origin())});window.close()}</script></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'` } });
}
export async function handle(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const session = unseal<Session>(request.cookies.get(sessionName)?.value);
  if (path === '/api/health' && request.method === 'GET') return json({ ok: true, githubConfigured: configured() });
  if (path === '/api/session' && request.method === 'GET') {
    const current = session || { csrf: random(), expires: Date.now() + 8 * 3600000 };
    const response = json({ configured: configured(), csrf: current.csrf, user: current.user || null, installed: Boolean(current.installed) });
    if (!session && configured()) cookie(response, sessionName, seal(current), 8 * 3600);
    return response;
  }
  if (request.method === 'POST') {
    if (!session || request.headers.get('origin') !== origin() || request.headers.get('x-csrf-token') !== session.csrf) return json({ error: 'Refresh the page and reconnect GitHub.' }, 403);
    if (path === '/api/logout') { const response = json({ ok: true }); cookie(response, sessionName, '', 0); return response; }
    if (path === '/api/auth/github/token') {
      if (!session.user || !session.token) return json({ error: 'Connect GitHub before publishing.' }, 401);
      return json({ token: session.token, expires: session.expires, user: session.user, installed: session.installed });
    }
  }
  if (request.method === 'GET' && ['/api/auth/github/start', '/api/auth/github/install'].includes(path)) {
    if (!configured()) return json({ error: 'GitHub publishing is waiting for the site owner to finish setup.' }, 503);
    if (request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'Start sign-in from the gallery editor.' }, 403);
    const install = path.endsWith('/install');
    if (install && !session?.user) return json({ error: 'Connect GitHub first.' }, 401);
    const state = random(), verifier = install ? undefined : random();
    const url = new URL(install ? `https://github.com/apps/${encodeURIComponent(process.env.GITHUB_APP_SLUG!)}/installations/new` : 'https://github.com/login/oauth/authorize');
    url.searchParams.set('state', state);
    if (!install) {
      url.searchParams.set('client_id', process.env.GITHUB_CLIENT_ID!);
      url.searchParams.set('redirect_uri', `${origin()}/api/auth/github/callback`);
      url.searchParams.set('code_challenge', createHash('sha256').update(verifier!).digest('base64url'));
      url.searchParams.set('code_challenge_method', 'S256');
    }
    const response = NextResponse.redirect(url);
    response.headers.set('Cache-Control', 'no-store');
    cookie(response, stateName, seal({ state, verifier, expires: Date.now() + 600000 }), 600);
    return response;
  }
  if (path === '/api/auth/github/callback' && request.method === 'GET') {
    let response: NextResponse;
    try {
      const pending = unseal<{ state: string; verifier?: string; expires: number }>(request.cookies.get(stateName)?.value);
      if (!pending || pending.state !== request.nextUrl.searchParams.get('state')) throw new Error('This sign-in link expired. Please connect again.');
      const code = request.nextUrl.searchParams.get('code');
      if (!code || request.nextUrl.searchParams.has('error')) throw new Error('GitHub connection was cancelled.');
      const exchange = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', redirect: 'error', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${origin()}/api/auth/github/callback`, ...(pending.verifier ? { code_verifier: pending.verifier } : {}) }), cache: 'no-store', signal: AbortSignal.timeout(20000) });
      const tokens = await exchange.json();
      if (!exchange.ok || typeof tokens.access_token !== 'string' || tokens.error) throw new Error('GitHub authorization expired. Please connect again.');
      const user = await github<{ id: number; login: string }>(tokens.access_token, '/user');
      let installed = false;
      for (let page = 1; page <= 10; page++) {
        const result = await github<{ installations: { app_id: number; account: { id: number }; suspended_at: string | null }[] }>(tokens.access_token, `/user/installations?per_page=100&page=${page}`);
        installed = result.installations.some(item => String(item.app_id) === process.env.GITHUB_APP_ID && item.account.id === user.id && !item.suspended_at);
        if (installed || result.installations.length < 100) break;
      }
      // No refresh tokens retained: reconnect after at most eight hours.
      const lifetime = Math.max(1, Math.min(Number(tokens.expires_in) || 28800, 28800) - 60);
      const next: Session = { csrf: random(), expires: Date.now() + lifetime * 1000, token: tokens.access_token, user: { id: user.id, login: user.login }, installed };
      response = popup(); cookie(response, sessionName, seal(next), lifetime);
    } catch { response = popup('GitHub connection could not finish. Close this window and connect again.'); }
    cookie(response, stateName, '', 0);
    return response;
  }
  return json({ error: 'This endpoint does not exist.' }, 404);
}
