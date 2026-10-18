import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  // Only the public site origin is exposed; credentials remain server-only.
  env: { NEXT_PUBLIC_APP_ORIGIN: process.env.APP_ORIGIN || '' },
  devIndicators: false,
  async headers() { return [{ source: '/:path*', headers: [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ] }]; },
};
export default config;
