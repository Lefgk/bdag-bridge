import config from './bridge-config.json';

export const CONTRACTS: Record<number, {
  router: `0x${string}`;
  bridge: `0x${string}`;
}> = Object.fromEntries(
  Object.entries(config.chains).map(([chainId, chain]) => [
    Number(chainId),
    {
      router: chain.contracts.router as `0x${string}`,
      bridge: chain.contracts.bridge as `0x${string}`,
    },
  ])
);
