// Only public gallery metadata and upload checkpoints; never credentials or GIF bytes.
export class Store {
  constructor(private storage: Storage = localStorage) {}
  private prefix = 'gg-publish-v2:';
  get<T>(bucket: string, id: string): T | undefined {
    const key = `${this.prefix}${bucket}:${id}`;
    const raw = this.storage.getItem(key);
    if (!raw) return undefined;
    const record = JSON.parse(raw);
    if (record.expires && record.expires < Date.now()) { this.storage.removeItem(key); return undefined; }
    return record.value as T;
  }
  put(bucket: string, id: string, value: unknown, expires?: number) {
    this.storage.setItem(`${this.prefix}${bucket}:${id}`, JSON.stringify({ value, expires }));
  }
  all<T>(bucket: string): T[] {
    const prefix = `${this.prefix}${bucket}:`;
    const keys = Array.from({ length: this.storage.length }, (_, i) => this.storage.key(i)).filter((key): key is string => Boolean(key?.startsWith(prefix)));
    return keys.map(key => this.get<T>(bucket, key.slice(prefix.length))).filter((value): value is T => value !== undefined);
  }
}
