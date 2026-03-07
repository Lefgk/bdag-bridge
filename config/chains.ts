import { defineChain } from 'viem';
import { bsc } from 'viem/chains';

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

export const blastChain = defineChain({
  id: 81457,
  name: 'Blast',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.blast.io'] },
  },
  blockExplorers: {
    default: { name: 'Blastscan', url: 'https://blastscan.io' },
  },
});

export const SOURCE_CHAINS = [
  { ...bsc, label: 'BNB Chain', color: '#F3BA2F' },
  { ...blastChain, label: 'Blast', color: '#FCFC03' },
] as const;

export const ALL_CHAINS = [...SOURCE_CHAINS, blockdag];
