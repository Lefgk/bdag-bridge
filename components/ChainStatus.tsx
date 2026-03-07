'use client';

import { useState, useEffect, useRef } from 'react';
import { getRpc, getBlockNumber, RELAYER_API } from '@/config/chainUtils';
import config from '@/config/bridge-config.json';

// Build chain list from config
const CHAINS = Object.entries(config.chains).map(([id, chain]) => ({
  chainId: Number(id),
  name: (chain as any).label as string,
}));

export function ChainStatus() {
  const [blocks, setBlocks] = useState<Record<number, number | null>>({});
  const [relayerBlocks, setRelayerBlocks] = useState<Record<number, number | null>>({});
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

      try {
        const res = await fetch(`${RELAYER_API}/status`);
        if (res.ok) {
          const data = await res.json();
          if (mountedRef.current) setRelayerBlocks(data.chains || {});
        }
      } catch { /* relayer offline */ }
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => { mountedRef.current = false; clearInterval(interval); };
  }, []);

  return (
    <div className="flex flex-col items-center gap-1 text-xs text-gray-500">
      <div className="flex gap-4 flex-wrap justify-center">
        {CHAINS.map((c) => {
          const head = blocks[c.chainId];
          const relayer = relayerBlocks[c.chainId];
          const behind = head != null && relayer != null ? head - relayer : null;
          return (
            <span key={c.chainId}>
              {c.name}: {head != null ? `#${head.toLocaleString()}` : '...'}
              {behind != null && behind > 0 && (
                <span className={behind > 100 ? 'text-yellow-500' : 'text-gray-600'}> (relayer: -{behind})</span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
