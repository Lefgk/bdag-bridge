export const CONTRACTS: Record<number, {
  router: `0x${string}`;
  bridgeERC20: `0x${string}`;
  liquidityManager: `0x${string}`;
}> = {
  // BSC (deployed)
  56: {
    router: '0x72da288d754607d15a389118052535a6d263dbdb',
    bridgeERC20: '0x46f50bD20c2F08741c5407adeECC3521cEe2Da19',
    liquidityManager: '0x086d7ec1806c74e339ef313f46cca5eabc0d0aaf',
  },
  // BlockDAG (deployed)
  1404: {
    router: '0x2cfbf23402af68f242452ab0c8a7ce00b9b791e9',
    bridgeERC20: '0x45dde3ba310f4abdf102f510f8f7a083c649efa9',
    liquidityManager: '0x761e492086fe858a0585c21d5300ffcea9b71945',
  },
  // ETH (not deployed yet)
  1: {
    router: '0x0000000000000000000000000000000000000000',
    bridgeERC20: '0x0000000000000000000000000000000000000000',
    liquidityManager: '0x0000000000000000000000000000000000000000',
  },
  // Base (not deployed yet)
  8453: {
    router: '0x0000000000000000000000000000000000000000',
    bridgeERC20: '0x0000000000000000000000000000000000000000',
    liquidityManager: '0x0000000000000000000000000000000000000000',
  },
  // Arbitrum (not deployed yet)
  42161: {
    router: '0x0000000000000000000000000000000000000000',
    bridgeERC20: '0x0000000000000000000000000000000000000000',
    liquidityManager: '0x0000000000000000000000000000000000000000',
  },
};

// Wrapped tokens on BlockDAG
export const WRAPPED_TOKENS: Record<string, `0x${string}`> = {
  wUSDT: '0xe4d9d1ea586bfe794860e601c5df056e181f2d05',
  wUSDC: '0xaea69e6c614bed0d4510f1fd9c8c5ca68b42719f',
  wETH: '0xa214b2bb3a880ce0d3b7c1df28b8dbf7b5ccad46',
  wBNB: '0x8707cacb12a6826e00c81a60fbb37cc7f24235bb',
};
