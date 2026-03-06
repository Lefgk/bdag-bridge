'use client';

import { useState, useEffect, useRef } from 'react';
import { BSC_CHAIN_ID, BDAG_CHAIN_ID, getRpc, chainName, getBlockNumber } from '@/config/chainUtils';

const CHAINS = [
  { chainId: BSC_CHAIN_ID, name: chainName(BSC_CHAIN_ID) },
  { chainId: BDAG_CHAIN_ID, name: chainName(BDAG_CHAIN_ID) },
];

export function ChainStatus() {
  const [blocks, setBlocks] = useState<Record<number, number | null>>({});
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const poll = async () => {
      const results: Record<number, number | null> = {};
      await Promise.all(
        CHAINS.map(async (c) => {
          try {
            results[c.chainId] = await getBlockNumber(getRpc(c.chainId));
          } catch {
            results[c.chainId] = null;
          }
        })
      );
      if (mountedRef.current) setBlocks(results);
    };
    poll();
    const interval = setInterval(poll, 10000);
    return () => { mountedRef.current = false; clearInterval(interval); };
  }, []);

  return (
    <div className="flex justify-center gap-4 text-xs text-gray-500">
      {CHAINS.map((c) => (
        <span key={c.chainId}>
          {c.name}: {blocks[c.chainId] != null ? `#${blocks[c.chainId]!.toLocaleString()}` : '...'}
        </span>
      ))}
    </div>
  );
}
