import type { Metadata } from 'next';
import '../styles.css';
export const metadata: Metadata = { title: 'gif & giggles — a GIF gallery maker for your group chat', description: 'Turn your friends’ funniest GIFs into a cute website. Add captions, pick a layout, and publish with GitHub or download for Netlify.' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
