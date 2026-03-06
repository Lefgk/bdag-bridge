'use client';

import { useState, useEffect } from 'react';

interface ChainBlock {
  name: string;
  chainId: number;
  block: number | null;
  rpc: string;
}

async function fetchBlockNumber(rpc: string): Promise<number | null> {
  try {
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
    });
    const json = await res.json();
    return parseInt(json.result, 16);
  } catch {
    return null;
  }
}

export function ChainStatus() {
  const [chains, setChains] = useState<ChainBlock[]>([
    { name: 'BNB Chain', chainId: 56, block: null, rpc: 'https://bsc-rpc.publicnode.com' },
    { name: 'BlockDAG', chainId: 1404, block: null, rpc: 'https://rpc.bdagscan.com' },
  ]);

  useEffect(() => {
    const poll = async () => {
      const updated = await Promise.all(
        chains.map(async (c) => ({
          ...c,
          block: await fetchBlockNumber(c.rpc),
        }))
      );
      setChains(updated);
    };
    poll();
    const interval = setInterval(poll, 10000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex justify-center gap-4 text-xs text-gray-500">
      {chains.map((c) => (
        <span key={c.chainId}>
          {c.name}: {c.block !== null ? `#${c.block.toLocaleString()}` : '...'}
        </span>
      ))}
    </div>
  );
}
