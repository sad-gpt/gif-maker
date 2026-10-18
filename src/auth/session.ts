import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
export type Session = { csrf: string; expires: number; user?: { id: number; login: string }; token?: string; installed?: boolean };
export const random = () => randomBytes(32).toString('base64url');
function key() {
  const secret = process.env.SESSION_SECRET || '';
  if (secret.length < 32) throw new Error('Set SESSION_SECRET using npm run setup:local.');
  return createHash('sha256').update(secret).digest();
}
export function seal(value: unknown) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv);
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64url');
}
export function unseal<T extends { expires: number }>(value?: string): T | undefined {
  if (!value) return;
  try {
    const bytes = Buffer.from(value, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const data = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')) as T;
    return data.expires > Date.now() ? data : undefined;
  } catch { return undefined; }
}
