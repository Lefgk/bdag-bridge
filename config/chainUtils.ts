import config from './bridge-config.json';

// Relayer API
export const RELAYER_API = process.env.NEXT_PUBLIC_RELAYER_API || config.relayer.api;

export const BSC_CHAIN_ID = 56;
export const BLAST_CHAIN_ID = 81457;
export const BDAG_CHAIN_ID = 1404;

// Build RPC lists from config
const RPC_LIST: Record<number, string[]> = Object.fromEntries(
  Object.entries(config.chains).map(([chainId, chain]) => [Number(chainId), chain.rpc])
);

const rpcIndex: Record<number, number> = {};

export function getRpc(chainId: number): string {
  const list = RPC_LIST[chainId] || RPC_LIST[BSC_CHAIN_ID];
  const idx = rpcIndex[chainId] || 0;
  return list[idx % list.length];
}

/** Rotate to next RPC for a chain (call on RPC failure) */
export function rotateRpc(chainId: number): string {
  const list = RPC_LIST[chainId] || RPC_LIST[BSC_CHAIN_ID];
  const next = ((rpcIndex[chainId] || 0) + 1) % list.length;
  rpcIndex[chainId] = next;
  return list[next];
}

// Keep backward compat
export const RPC: Record<number, string> = Object.fromEntries(
  Object.entries(RPC_LIST).map(([chainId, list]) => [Number(chainId), list[0]])
);

export function getDestChainId(sourceChainId: number): number {
  // All source chains bridge to BDAG; BDAG bridges back to BSC by default
  return sourceChainId === BDAG_CHAIN_ID ? BSC_CHAIN_ID : BDAG_CHAIN_ID;
}

/** Get all possible destination chains for a given source */
export function getDestChains(sourceChainId: number): number[] {
  if (sourceChainId === BDAG_CHAIN_ID) {
    // BDAG can bridge to any non-BDAG chain
    return Object.keys(config.chains).map(Number).filter(id => id !== BDAG_CHAIN_ID);
  }
  return [BDAG_CHAIN_ID];
}

export function chainName(chainId: number): string {
  const chain = config.chains[String(chainId) as keyof typeof config.chains];
  return chain?.name || `Chain ${chainId}`;
}

export function chainLabel(chainId: number): string {
  const chain = config.chains[String(chainId) as keyof typeof config.chains];
  return chain?.label || String(chainId);
}

export function explorerTxUrl(hash: string, chainId: number): string {
  const chain = config.chains[String(chainId) as keyof typeof config.chains];
  return chain ? `${chain.explorer}/tx/${hash}` : '#';
}

export function explorerLabel(chainId: number): string {
  const chain = config.chains[String(chainId) as keyof typeof config.chains];
  if (!chain) return 'Explorer';
  if (chain.label === 'BSC') return 'BSCScan';
  if (chain.label === 'Blast') return 'Blastscan';
  return `${chain.label}Scan`;
}

export function getRequiredConfirmations(chainId: number): number {
  const chain = config.chains[String(chainId) as keyof typeof config.chains];
  return chain?.confirmations || 15;
}

// JSON-RPC helper with timeout
export async function rpcCall(rpc: string, method: string, params: any[], timeoutMs = 15000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error.message);
    return json.result;
  } finally {
    clearTimeout(timer);
  }
}

export async function getBlockNumber(rpc: string): Promise<number> {
  const hex = await rpcCall(rpc, 'eth_blockNumber', []);
  return parseInt(hex, 16);
}
