import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { readLocal, saveDraft } from './draft';
import type { Draft } from './draft';
import { DEFAULT_SETTINGS } from './types';
it('persists image bytes, caption edits and publication identity without stale blob URLs', async () => {
  await saveDraft([{ id: '1', name: 'one.gif', caption: 'the punchline', extension: 'gif', blob: new Blob(['gif-bytes']), url: 'blob:expires-on-reload' }], DEFAULT_SETTINGS, { repoId: 10, owner: 'me', name: 'friends' });
  const saved = await readLocal<Draft>('current');
  expect(saved?.items[0].caption).toBe('the punchline');
  expect(await saved?.items[0].blob.text()).toBe('gif-bytes');
  expect(saved?.items[0]).not.toHaveProperty('url');
  expect(saved?.publication?.repoId).toBe(10);
});
