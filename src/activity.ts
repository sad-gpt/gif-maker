import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { unseal, type Session } from './auth/session';

const eventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('zip_export'), id: z.uuid() }).strict(),
  z.object({ type: z.literal('github_publish'), id: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/), repoId: z.number().int().positive(), update: z.boolean() }).strict(),
]);
const countScript = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('SET', KEYS[1], '1')
redis.call('HINCRBY', KEYS[2], ARGV[1], 1)
redis.call('HINCRBY', KEYS[3], ARGV[1], 1)
redis.call('EXPIRE', KEYS[3], 34560000)
return 1`;
const rateScript = `local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], 3600) end; return n`;
function config() {
  return { url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN };
}
async function redis(command: (string | number)[]) {
  const { url, token } = config();
  const response = await fetch(url!, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command), cache: 'no-store', signal: AbortSignal.timeout(4000) });
  if (!response.ok) throw new Error('Activity store unavailable');
  const data = await response.json();
  if (data.error) throw new Error('Activity store unavailable');
  return data.result;
}
const reply = (status: number) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
export async function recordActivity(request: NextRequest) {
  const { url, token } = config();
  // Preview deployments and local development must not inflate production totals.
  if (!url || !token || process.env.NODE_ENV !== 'production' || (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production')) return reply(204);
  const expectedOrigin = new URL(process.env.APP_ORIGIN || 'http://127.0.0.1:5173').origin;
  if (request.headers.get('origin') !== expectedOrigin || !request.headers.get('content-type')?.startsWith('application/json')) return reply(403);
  const raw = await request.text();
  if (raw.length > 512) return reply(413);
  let parsed;
  try { parsed = eventSchema.safeParse(JSON.parse(raw)); } catch { return reply(400); }
  if (!parsed.success) return reply(400);
  const event = parsed.data;
  const session = unseal<Session>(request.cookies.get('gg_next_session')?.value);
  if (event.type === 'github_publish' && (!session?.token || !session.user)) return reply(401);
  try {
    const secret = process.env.SESSION_SECRET;
    if (!secret) return reply(503);
    const day = new Date().toISOString().slice(0, 10);
    const hash = (value: string) => createHmac('sha256', secret).update(value).digest('hex');
    const ip = request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for') || 'unknown';
    const bucket = hash(`${day}:${session?.user?.id || ip}`);
    if (await redis(['EVAL', rateScript, 1, `gg:activity:rate:${bucket}`]) > 60) return reply(429);
    const field = event.type === 'zip_export' ? 'zip_exports' : event.update ? 'github_updates' : 'github_galleries';
    const identity = event.type === 'zip_export' ? event.id : event.update ? `${event.repoId}:${event.id}` : String(event.repoId);
    const dedupe = `gg:activity:seen:${hash(`${field}:${identity}`)}`;
    if (await redis(['EXISTS', dedupe])) return reply(204);
    if (event.type === 'github_publish') {
      const github = async (path: string) => {
        const response = await fetch(`https://api.github.com${path}`, { headers: { Authorization: `Bearer ${session!.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, cache: 'no-store', signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error('Gallery verification failed');
        return response.json();
      };
      const repo = await github(`/repositories/${event.repoId}`);
      if (repo.owner.id !== session!.user!.id || repo.private || !repo.description?.startsWith('A GIF gallery made with gif & giggles. Publish ID: ')) return reply(403);
      const build = await github(`/repos/${encodeURIComponent(repo.owner.login)}/${encodeURIComponent(repo.name)}/pages/builds/latest`);
      if (build.status !== 'built') return reply(409);
    }
    await redis(['EVAL', countScript, 3, dedupe, 'gg:activity:totals', `gg:activity:daily:${day}`, field]);
    return reply(204);
  } catch {
    // No credentials, URLs, or user content in logs or responses.
    console.warn('Activity counter unavailable');
    return reply(503);
  }
}
