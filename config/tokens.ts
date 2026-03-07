import config from './bridge-config.json';
import { getDestChainId } from './chainUtils';

export interface Token {
  symbol: string;
  name: string;
  decimals: Record<number, number>; // chainId => decimals
  isNative?: boolean;
  icon: string; // URL to token icon
  addresses: Record<number, string>; // chainId => address
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

export function getTokensForChain(chainId: number): Token[] {
  const destChainId = getDestChainId(chainId);
  return BRIDGE_TOKENS.filter(t => t.addresses[chainId] && t.addresses[destChainId]);
}

export function getDecimals(token: Token, chainId: number): number {
  return token.decimals[chainId] ?? 18;
}
