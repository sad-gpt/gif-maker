export type UserSession = { configured: boolean; csrf: string; user: { id: number; login: string } | null; installed: boolean };
export type PublishJob = { id: string; name: string; owner: string; repoId?: number; uploaded: string[]; status: 'creating' | 'uploading' | 'publishing' | 'live' | 'failed'; url?: string; repositoryUrl: string; error?: string };
export class RequestError extends Error {
  constructor(message: string, public status: number, public retryAfter = 0) { super(message); }
}
export async function api<T>(path: string, options: RequestInit = {}, csrf?: string): Promise<T> {
  let response: Response;
  try { response = await fetch(path, { cache: 'no-store', signal: AbortSignal.timeout(15000), ...options, credentials: 'same-origin', headers: { ...options.headers, ...(csrf ? { 'X-CSRF-Token': csrf } : {}) } }); }
  catch { throw new RequestError('The publishing service could not be reached. Your draft is saved on this device.', 503, 10); }
  const result = await response.json().catch(() => null);
  if (!response.ok || result === null) throw new RequestError(result?.error || 'The publishing service is temporarily unavailable.', response.status || 503, result?.retryAfter || 0);
  return result as T;
}
export const post = <T>(path: string, data: unknown, csrf: string) => api<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }, csrf);
