import type { Metadata } from 'next';
import { Providers } from './providers';
import { Navbar } from '@/components/Navbar';
import bridgeConfig from '@/config/bridge-config.json';
import './globals.css';

export const metadata: Metadata = {
  title: 'Prosperity Bridge',
  description: 'Bridge tokens across chains with Prosperity Bridge',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-mono min-h-screen">
        <Providers>
          <Navbar />
          <main className="mx-auto px-4 py-8">
            {children}
          </main>
          <div className="fixed bottom-2 right-3 text-[10px] text-gray-600">
            v{bridgeConfig.version}
          </div>
        </Providers>
      </body>
    </html>
  );
}
