'use client';

import { useState, useEffect, useCallback } from 'react';
import config from '@/config/bridge-config.json';

const RELAYER_API = (config as any).relayerApi || 'http://localhost:3032';

export interface ChainBalance {
  chainId: number;
  chainName: string;
  balance: string;
  symbol: string;
  txsRemaining: number;
  paused: boolean;
  lastChecked: number;
}

export interface RelayerBalances {
  balances: ChainBalance[];
  relayer: string;
  warningThreshold: number;
  criticalThreshold: number;
}

export function useRelayerBalances() {
  const [data, setData] = useState<RelayerBalances | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const fetchBalances = useCallback(async () => {
    setLoading(true);
    setError(undefined);

    try {
      const res = await fetch(`${RELAYER_API}/balances`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const json = await res.json();

      const chains = config.chains as Record<string, { name: string }>;
      const balances: ChainBalance[] = Object.entries(json.balances || {}).map(
        ([chainId, val]: [string, any]) => ({
          chainId: Number(chainId),
          chainName: chains[chainId]?.name || `Chain ${chainId}`,
          balance: val.balance,
          symbol: val.symbol,
          txsRemaining: val.txsRemaining,
          paused: val.paused,
          lastChecked: val.lastChecked,
        })
      );

      // Sort: paused first, then by txsRemaining ascending
      balances.sort((a, b) => {
        if (a.paused !== b.paused) return a.paused ? -1 : 1;
        return a.txsRemaining - b.txsRemaining;
      });

      setData({
        balances,
        relayer: json.relayer || '',
        warningThreshold: json.warningThreshold || 10,
        criticalThreshold: json.criticalThreshold || 3,
      });
    } catch (err: any) {
      setError(err.message || 'Failed to load balances');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBalances();
    const interval = setInterval(fetchBalances, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, [fetchBalances]);

  return { data, loading, error, refetch: fetchBalances };
}
