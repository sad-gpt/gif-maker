import type { Metadata } from 'next';
import '../styles.css';
export const metadata: Metadata = { title: 'gif & giggles | A little website for your memories', description: 'Turn photos, GIFs, and stickers into a shareable website for couple memories, friends, and family trips. Add captions, choose a layout, and share.' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
