'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Overview' },
  { href: '/responses', label: 'Responses' },
  { href: '/review', label: 'Review queue' },
  { href: '/settings', label: 'Settings' },
];

export function Sidebar({ reviewCount }: { reviewCount: number }) {
  const path = usePathname();
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="dot" />
        CSAT · Periskope
      </div>
      <nav className="nav">
        {LINKS.map((l) => {
          const active = l.href === '/' ? path === '/' : path.startsWith(l.href);
          return (
            <Link key={l.href} href={l.href} className={active ? 'active' : ''}>
              <span>{l.label}</span>
              {l.href === '/review' && reviewCount > 0 && <span className="badge">{reviewCount}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
