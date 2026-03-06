'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { mainnet, bsc, base, arbitrum } from 'wagmi/chains';
import { RainbowKitProvider, getDefaultConfig, darkTheme } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import { blockdag } from '@/config/chains';

const config = getDefaultConfig({
  appName: 'BlockDAG Bridge',
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || 'demo',
  chains: [mainnet, bsc, base, arbitrum, blockdag],
  transports: {
    [mainnet.id]: http(),
    [bsc.id]: http(),
    [base.id]: http(),
    [arbitrum.id]: http(),
    [blockdag.id]: http('https://rpc.bdagscan.com'),
  },
});

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
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
