// Centralized chain configuration — single source of truth for RPCs, names, explorers

// Relayer API (runs on the bridge-relayer EC2 instance)
export const RELAYER_API = process.env.NEXT_PUBLIC_RELAYER_API || 'https://town-weblog-enlargement-persian.trycloudflare.com';

export const BSC_CHAIN_ID = 56;
export const BDAG_CHAIN_ID = 1404;

export const RPC: Record<number, string> = {
  [BSC_CHAIN_ID]: 'https://bsc-rpc.publicnode.com',
  [BDAG_CHAIN_ID]: 'https://rpc.bdagscan.com',
};

export function getRpc(chainId: number): string {
  return RPC[chainId] || RPC[BSC_CHAIN_ID];
}

export function getDestChainId(sourceChainId: number): number {
  return sourceChainId === BDAG_CHAIN_ID ? BSC_CHAIN_ID : BDAG_CHAIN_ID;
}

export function chainName(chainId: number): string {
  if (chainId === BSC_CHAIN_ID) return 'BNB Chain';
  if (chainId === BDAG_CHAIN_ID) return 'BlockDAG';
  return `Chain ${chainId}`;
}

export function chainLabel(chainId: number): string {
  if (chainId === BSC_CHAIN_ID) return 'BSC';
  if (chainId === BDAG_CHAIN_ID) return 'BDAG';
  return String(chainId);
}

export function explorerTxUrl(hash: string, chainId: number): string {
  if (chainId === BSC_CHAIN_ID) return `https://bscscan.com/tx/${hash}`;
  if (chainId === BDAG_CHAIN_ID) return `https://bdagscan.com/tx/${hash}`;
  return '#';
}

export function explorerLabel(chainId: number): string {
  if (chainId === BSC_CHAIN_ID) return 'BSCScan';
  if (chainId === BDAG_CHAIN_ID) return 'BDAGScan';
  return 'Explorer';
}

// Required confirmations per chain before relayer picks up
export function getRequiredConfirmations(chainId: number): number {
  if (chainId === BDAG_CHAIN_ID) return 2;
  return 15; // BSC
}

// JSON-RPC helper
export async function rpcCall(rpc: string, method: string, params: any[]): Promise<any> {
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

export async function getBlockNumber(rpc: string): Promise<number> {
  const hex = await rpcCall(rpc, 'eth_blockNumber', []);
  return parseInt(hex, 16);
}
