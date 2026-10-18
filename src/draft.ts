import type { GalleryItem, GallerySettings } from './types';
export type Publication = { repoId: number; owner: string; name: string; url?: string };
export type Draft = { items: Omit<GalleryItem, 'url'>[]; settings: GallerySettings; publication?: Publication; updated: number };
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('gif-and-giggles', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readLocal<T>(key: string): Promise<T | undefined> {
  const db = await database();
  try { return await new Promise((resolve, reject) => { const request = db.transaction('drafts').objectStore('drafts').get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); } finally { db.close(); }
}
export async function writeLocal(key: string, value: unknown) {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => { const transaction = db.transaction('drafts', 'readwrite'); transaction.objectStore('drafts').put(value, key); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); }); } finally { db.close(); }
}
export function saveDraft(items: GalleryItem[], settings: GallerySettings, publication?: Publication) {
  return writeLocal('current', { items: items.map(({ url: _url, ...item }) => item), settings, publication, updated: Date.now() } satisfies Draft);
}
