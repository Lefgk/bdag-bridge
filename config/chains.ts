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

export const SOURCE_CHAINS = [
  { ...bsc, label: 'BNB Chain', color: '#F3BA2F' },
] as const;

export const ALL_CHAINS = [...SOURCE_CHAINS, blockdag];
