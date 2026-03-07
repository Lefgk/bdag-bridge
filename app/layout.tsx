import type { Metadata } from 'next';
import { Providers } from './providers';
import { Navbar } from '@/components/Navbar';
import './globals.css';

export const metadata: Metadata = {
  title: 'BlockDAG Bridge',
  description: 'Bridge tokens to BlockDAG Network',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-mono min-h-screen">
        <Providers>
          <Navbar />
          <main className="max-w-2xl mx-auto px-4 py-8">
            {children}
          </main>
          <div className="fixed bottom-2 right-3 text-[10px] text-gray-600">
            v0.3.0
          </div>
        </Providers>
      </body>
    </html>
  );
}
