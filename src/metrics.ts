// Best-effort telemetry must never block publishing or downloads.
export function trackActivity(event: { type: 'zip_export'; id: string } | { type: 'github_publish'; repoId: number; update: boolean; id: string }) {
  if (process.env.NODE_ENV !== 'production') return;
  void fetch('/api/activity', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin', body: JSON.stringify(event), keepalive: true,
    signal: AbortSignal.timeout(8000),
  }).catch(() => {});
}
