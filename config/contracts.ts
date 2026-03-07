import config from './bridge-config.json';

export const CONTRACTS: Record<number, {
  router: `0x${string}`;
  bridgeERC20: `0x${string}`;
  liquidityManager: `0x${string}`;
}> = Object.fromEntries(
  Object.entries(config.chains).map(([chainId, chain]) => [
    Number(chainId),
    {
      router: chain.contracts.router as `0x${string}`,
      bridgeERC20: chain.contracts.bridgeERC20 as `0x${string}`,
      liquidityManager: chain.contracts.liquidityManager as `0x${string}`,
    },
  ])
);
