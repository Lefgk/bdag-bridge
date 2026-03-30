import config from './bridge-config.json';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// Chain ID constants
export const BDAG_CHAIN_ID = 1404;

// Build RPC lists from config
const RPC_LIST: Record<number, string[]> = Object.fromEntries(
  Object.entries(config.chains).map(([chainId, chain]) => [Number(chainId), chain.rpc])
);

const rpcIndex: Record<number, number> = {};

export function getRpc(chainId: number): string {
  const list = RPC_LIST[chainId];
  if (!list || list.length === 0) return '';
  const idx = rpcIndex[chainId] || 0;
  return list[idx % list.length];
}

export function rotateRpc(chainId: number): string {
  const list = RPC_LIST[chainId];
  if (!list || list.length === 0) return '';
  const next = ((rpcIndex[chainId] || 0) + 1) % list.length;
  rpcIndex[chainId] = next;
  return list[next];
}

/** Returns all configured chain IDs. */
export function getConfiguredChainIds(): number[] {
  return Object.keys(config.chains).map(Number);
}

/** Returns valid destination chains for a given source.
 *  Hub-and-spoke: source chains can only bridge to BDAG, BDAG can bridge to any source chain. */
export function getDestinationChains(sourceChainId: number): number[] {
  if (sourceChainId === BDAG_CHAIN_ID) {
    return getConfiguredChainIds().filter(id => id !== BDAG_CHAIN_ID);
  }
  return [BDAG_CHAIN_ID];
}

/** Lookup Hyperlane domain ID for a chain. */
export function getHyperlaneDomain(chainId: number): number {
  const chain = config.chains[String(chainId) as keyof typeof config.chains] as any;
  return chain?.hyperlaneDomain ?? chainId;
}

/** Build Hyperlane Explorer URL for a message ID. */
export function getHyperlaneExplorerUrl(messageId: string): string {
  return `${config.hyperlaneExplorer}/?search=${messageId}`;
}

/** Check if an address is the zero placeholder (contract not deployed yet). */
export function isPlaceholderAddress(addr: string): boolean {
  return !addr || addr === ZERO_ADDRESS;
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
