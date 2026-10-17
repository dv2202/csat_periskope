import './globals.css';
import { Sidebar } from '@/components/Sidebar';

export const metadata = {
  title: 'CSAT for Periskope',
  description: 'External CSAT + AI reply parser add-on for Periskope.',
};

export const dynamic = 'force-dynamic';

async function reviewCount(): Promise<number> {
  try {
    const { getReviewQueue } = await import('@/lib/stats');
    return (await getReviewQueue()).length;
  } catch {
    return 0; // DB not reachable (e.g. first boot); don't block render
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const reviews = await reviewCount();
  return (
    <html lang="en">
      <body>
        <div className="layout">
          <Sidebar reviewCount={reviews} />
          <div className="main">
            <div className="content">{children}</div>
          </div>
        </div>
      </body>
    </html>
  );
}
