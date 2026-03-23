'use client';

import { useState, useEffect, useRef } from 'react';
import { getRpc, getBlockNumber, isPlaceholderAddress } from '@/config/chainUtils';
import { CONTRACTS } from '@/config/contracts';
import config from '@/config/bridge-config.json';

const CHAINS = Object.entries(config.chains).map(([id, chain]) => ({
  chainId: Number(id),
  name: (chain as any).label as string,
}));

export function ChainStatus() {
  const [blocks, setBlocks] = useState<Record<number, number | null>>({});
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const poll = async () => {
      const results: Record<number, number | null> = {};
      await Promise.all(
        CHAINS.map(async (c) => {
          try { results[c.chainId] = await getBlockNumber(getRpc(c.chainId)); }
          catch { results[c.chainId] = null; }
        })
      );
      if (mountedRef.current) setBlocks(results);
    };
    poll();
    const interval = setInterval(poll, 10000);
    return () => { mountedRef.current = false; clearInterval(interval); };
  }, []);

  return (
    <div className="flex flex-col items-center gap-1 text-xs text-gray-500">
      <div className="flex gap-4 flex-wrap justify-center">
        {CHAINS.map((c) => {
          const head = blocks[c.chainId];
          const contracts = CONTRACTS[c.chainId];
          const deployed = contracts && !isPlaceholderAddress(contracts.router);
          return (
            <span key={c.chainId}>
              {c.name}: {head != null ? `#${head.toLocaleString()}` : '...'}
              {deployed && <span className="text-green-500"> ✓</span>}
              {!deployed && <span className="text-gray-600"> (not deployed)</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}
