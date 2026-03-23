import config from './bridge-config.json';
import { isPlaceholderAddress } from './chainUtils';

export interface Token {
  symbol: string;
  name: string;
  decimals: Record<number, number>;
  isNative?: boolean;
  icon: string;
  addresses: Record<number, string>;
}

export const BRIDGE_TOKENS: Token[] = config.tokens.map(t => ({
  symbol: t.symbol,
  name: t.name,
  icon: t.icon,
  decimals: Object.fromEntries(
    Object.entries(t.addresses).map(([chainId, info]) => [Number(chainId), info.decimals])
  ),
  addresses: Object.fromEntries(
    Object.entries(t.addresses).map(([chainId, info]) => [Number(chainId), info.address])
  ),
}));

/** Returns tokens available on both source and destination chains (ignoring placeholder addresses). */
export function getTokensForChain(sourceChainId: number, destChainId: number): Token[] {
  return BRIDGE_TOKENS.filter(t => {
    const srcAddr = t.addresses[sourceChainId];
    const dstAddr = t.addresses[destChainId];
    return srcAddr && dstAddr && !isPlaceholderAddress(srcAddr) && !isPlaceholderAddress(dstAddr);
  });
}

export function getDecimals(token: Token, chainId: number): number {
  return token.decimals[chainId] ?? 18;
}
