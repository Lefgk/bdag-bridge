import { defineChain } from 'viem';
import { bsc, polygon, arbitrum, base, avalanche } from 'viem/chains';

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

export const sonicChain = defineChain({
  id: 146,
  name: 'Sonic',
  nativeCurrency: { name: 'Sonic', symbol: 'S', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.soniclabs.com'] },
  },
  blockExplorers: {
    default: { name: 'SonicScan', url: 'https://sonicscan.org' },
  },
});

export const SUPPORTED_CHAINS = [
  { ...bsc, label: 'BNB Chain', color: '#F3BA2F' },
  { ...polygon, label: 'Polygon', color: '#8247E5' },
  { ...arbitrum, label: 'Arbitrum', color: '#28A0F0' },
  { ...base, label: 'Base', color: '#0052FF' },
  { ...avalanche, label: 'Avalanche', color: '#E84142' },
  { ...blastChain, label: 'Blast', color: '#FCFC03' },
  { ...sonicChain, label: 'Sonic', color: '#1DB954' },
  { ...blockdag, label: 'BlockDAG', color: '#00d4ff' },
] as const;

export const ALL_CHAINS = SUPPORTED_CHAINS.map(c => c);
