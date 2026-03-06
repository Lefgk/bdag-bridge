'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ConnectButton } from '@rainbow-me/rainbowkit';

export function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-gray-800 bg-bg-dark/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link href="/" className="text-xl font-sans font-bold text-accent">
            BDAG Bridge
          </Link>
          <div className="flex gap-1">
            <Link
              href="/"
              className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                pathname === '/'
                  ? 'bg-card text-accent'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Bridge
            </Link>
            <Link
              href="/liquidity"
              className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                pathname === '/liquidity'
                  ? 'bg-card text-accent'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Liquidity
            </Link>
          </div>
        </div>
        <ConnectButton showBalance={false} chainStatus="icon" />
      </div>
    </nav>
  );
}
