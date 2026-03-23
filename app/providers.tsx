'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, http } from 'wagmi';
import { mainnet, bsc, polygon, arbitrum, optimism, base, avalanche } from 'wagmi/chains';
import { RainbowKitProvider, getDefaultConfig, darkTheme } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import { blockdag, blastChain, sonicChain } from '@/config/chains';

const config = getDefaultConfig({
  appName: 'Prosperity Bridge',
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || 'demo',
  chains: [mainnet, bsc, polygon, arbitrum, optimism, base, avalanche, blastChain, sonicChain, blockdag],
  transports: {
    [mainnet.id]: http(),
    [bsc.id]: http(),
    [polygon.id]: http(),
    [arbitrum.id]: http(),
    [optimism.id]: http(),
    [base.id]: http(),
    [avalanche.id]: http(),
    [blastChain.id]: http('https://rpc.blast.io'),
    [sonicChain.id]: http('https://rpc.soniclabs.com'),
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
