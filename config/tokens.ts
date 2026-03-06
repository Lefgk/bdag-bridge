export interface Token {
  symbol: string;
  name: string;
  decimals: Record<number, number>; // chainId => decimals
  isNative?: boolean;
  icon: string; // URL to token icon
  addresses: Record<number, string>; // chainId => address
}

export const BRIDGE_TOKENS: Token[] = [
  {
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: { 56: 18, 1404: 18 },
    icon: 'https://assets.coingecko.com/coins/images/325/small/Tether.png',
    addresses: {
      56: '0x55d398326f99059fF775485246999027B3197955',
      1404: '0xe4d9d1ea586bfe794860e601c5df056e181f2d05', // wUSDT
    },
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: { 56: 18, 1404: 18 },
    icon: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
    addresses: {
      56: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
      1404: '0xaea69e6c614bed0d4510f1fd9c8c5ca68b42719f', // wUSDC
    },
  },
  {
    symbol: 'WBNB',
    name: 'Wrapped BNB',
    decimals: { 56: 18, 1404: 18 },
    icon: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
    addresses: {
      56: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
      1404: '0x8707cacb12a6826e00c81a60fbb37cc7f24235bb', // wBNB
    },
  },
];

export function getTokensForChain(chainId: number): Token[] {
  return BRIDGE_TOKENS.filter(t => t.addresses[chainId]);
}

export function getDecimals(token: Token, chainId: number): number {
  return token.decimals[chainId] ?? 18;
}
