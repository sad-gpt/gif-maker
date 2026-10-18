export async function digest(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))).map(n => n.toString(16).padStart(2, '0')).join('');
}
export function base64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}
export function decode64(value: string) { return Uint8Array.from(atob(value.replace(/\s/g, '')), char => char.charCodeAt(0)); }
