'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, http } from 'wagmi';
import { bsc, polygon, arbitrum, base, avalanche } from 'wagmi/chains';
import {
  RainbowKitProvider,
  getDefaultConfig,
  darkTheme,
} from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import { blockdag, blastChain, sonicChain } from '@/config/chains';

const config = getDefaultConfig({
  appName: 'Prosperity Bridge',
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || 'demo',
  chains: [bsc, polygon, arbitrum, base, avalanche, blastChain, sonicChain, blockdag],
  transports: {
    [bsc.id]: http(),
    [polygon.id]: http(),
    [arbitrum.id]: http(),
    [base.id]: http(),
    [avalanche.id]: http(),
    [blastChain.id]: http('https://rpc.blast.io'),
    [sonicChain.id]: http('https://rpc.soniclabs.com'),
    [blockdag.id]: http('https://rpc.bdagscan.com'),
  },
  ssr: true,
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    },
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          locale="en-US"
          theme={darkTheme({
            accentColor: '#00d4ff',
            accentColorForeground: '#050810',
            borderRadius: 'medium',
          })}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
