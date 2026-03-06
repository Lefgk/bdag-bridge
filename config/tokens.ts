export interface Token {
  symbol: string;
  name: string;
  decimals: number;
  isNative?: boolean;
  addresses: Record<number, string>; // chainId => address
}

export const BRIDGE_TOKENS: Token[] = [
  {
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 18,
    addresses: {
      56: '0x55d398326f99059fF775485246999027B3197955',
    },
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 18,
    addresses: {
      56: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    },
  },
  {
    symbol: 'BNB',
    name: 'BNB',
    decimals: 18,
    isNative: true,
    addresses: {
      56: '0x0000000000000000000000000000000000000000',
    },
  },
  {
    symbol: 'WBNB',
    name: 'Wrapped BNB',
    decimals: 18,
    addresses: {
      56: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    },
  },
];

export function getTokensForChain(chainId: number): Token[] {
  return BRIDGE_TOKENS.filter(t => t.addresses[chainId]);
}
