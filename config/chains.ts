import { defineChain } from 'viem';
import { mainnet, bsc, base, arbitrum } from 'viem/chains';

export const blockdag = defineChain({
  id: 1404,
  name: 'BlockDAG',
  nativeCurrency: { name: 'BDAG', symbol: 'BDAG', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.bdagscan.com'] },
  },
  blockExplorers: {
    default: { name: 'BDAGScan', url: 'https://bdagscan.com' },
  },
});

export const SOURCE_CHAINS = [
  { ...mainnet, label: 'Ethereum', color: '#627EEA' },
  { ...bsc, label: 'BNB Chain', color: '#F3BA2F' },
  { ...base, label: 'Base', color: '#0052FF' },
  { ...arbitrum, label: 'Arbitrum', color: '#28A0F0' },
] as const;

export const ALL_CHAINS = [...SOURCE_CHAINS, blockdag];
