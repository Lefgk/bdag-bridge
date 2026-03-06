export interface Token {
  symbol: string;
  name: string;
  decimals: number;
  isNative?: boolean;
  addresses: Record<number, string>; // chainId => address
}

// Fill in addresses after deployment
export const BRIDGE_TOKENS: Token[] = [
  {
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    addresses: {
      1: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      56: '0x55d398326f99059fF775485246999027B3197955',
      42161: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    },
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    addresses: {
      1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      56: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
      8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    },
  },
  {
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
    addresses: {
      1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      8453: '0x4200000000000000000000000000000000000006',
      42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    },
  },
  {
    symbol: 'ETH',
    name: 'Ether',
    decimals: 18,
    isNative: true,
    addresses: {
      1: '0x0000000000000000000000000000000000000000',
      8453: '0x0000000000000000000000000000000000000000',
      42161: '0x0000000000000000000000000000000000000000',
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
