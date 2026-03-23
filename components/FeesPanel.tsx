'use client';

import { useState, useEffect, useCallback } from 'react';
import config from '@/config/bridge-config.json';
import { getRpc, rpcCall, isPlaceholderAddress } from '@/config/chainUtils';
import { formatUnits } from 'viem';

// ── On-chain read helpers ────────────────────────────────────────────────────

async function ethCall(chainId: number, to: string, data: string): Promise<string> {
  const rpc = getRpc(chainId);
  const result = await rpcCall(rpc, 'eth_call', [{ to, data }, 'latest']);
  return result && result !== '0x' ? result : '0x' + '0'.repeat(64);
}

async function fetchFeeRecipient(chainId: number, bridge: string): Promise<string> {
  try {
    // feeRecipient() selector
    const result = await ethCall(chainId, bridge, '0x46904840');
    return '0x' + result.slice(-40);
  } catch { return '0x' + '0'.repeat(40); }
}

async function fetchDefaultFeeRate(chainId: number, bridge: string): Promise<bigint> {
  try {
    // defaultBridgeFee() selector
    const result = await ethCall(chainId, bridge, '0x6ced0c92');
    return BigInt(result);
  } catch { return 0n; }
}

async function fetchTotalBridgeTxCount(chainId: number, bridge: string): Promise<number> {
  try {
    // totalBridgeTxCount() selector
    const result = await ethCall(chainId, bridge, '0x2dfdf0b5');
    return Number(BigInt(result));
  } catch { return 0; }
}

async function fetchDepositNonce(chainId: number, bridge: string): Promise<number> {
  try {
    // depositNonce() selector
    const result = await ethCall(chainId, bridge, '0xde35f282');
    return Number(BigInt(result));
  } catch { return 0; }
}

// ── Formatting ────────────────────────────────────────────────────────────────

function getChainConfig(chainId: number) {
  return config.chains[String(chainId) as keyof typeof config.chains];
}

function fmt(amount: bigint, decimals: number): string {
  const num = parseFloat(formatUnits(amount, decimals));
  if (num === 0) return '0';
  if (num < 0.0001) return num.toFixed(7);
  if (num < 1) return num.toFixed(4);
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChainRow {
  chainId: number;
  chainName: string;
  bridgeAddress: string;
  feeRecipient: string;
  feeRatePpm: bigint;
  depositNonce: number;
  txCount: number;
  deployed: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function FeesPanel() {
  const [rows, setRows] = useState<ChainRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result: ChainRow[] = [];

    const chainIds = Object.keys(config.chains).map(Number);

    await Promise.all(chainIds.map(async (chainId) => {
      const chain = getChainConfig(chainId);
      if (!chain) return;

      const bridgeAddr = chain.contracts.bridge;
      const deployed = !isPlaceholderAddress(bridgeAddr);

      if (!deployed) {
        result.push({
          chainId,
          chainName: chain.label,
          bridgeAddress: bridgeAddr,
          feeRecipient: '',
          feeRatePpm: 0n,
          depositNonce: 0,
          txCount: 0,
          deployed: false,
        });
        return;
      }

      const [feeRecipient, defaultFeeRate, depositNonce, txCount] = await Promise.all([
        fetchFeeRecipient(chainId, bridgeAddr),
        fetchDefaultFeeRate(chainId, bridgeAddr),
        fetchDepositNonce(chainId, bridgeAddr),
        fetchTotalBridgeTxCount(chainId, bridgeAddr),
      ]);

      result.push({
        chainId,
        chainName: chain.label,
        bridgeAddress: bridgeAddr,
        feeRecipient,
        feeRatePpm: defaultFeeRate,
        depositNonce,
        txCount,
        deployed: true,
      });
    }));

    // Sort: deployed first, then by txCount
    result.sort((a, b) => {
      if (a.deployed && !b.deployed) return -1;
      if (!a.deployed && b.deployed) return 1;
      return b.txCount - a.txCount;
    });
    setRows(result);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const deployedRows = rows.filter(r => r.deployed);
  const feePercent = deployedRows.length > 0 && deployedRows[0].feeRatePpm > 0n
    ? (Number(deployedRows[0].feeRatePpm) / 10000).toFixed(2)
    : '0.60';

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-sans font-bold text-white mb-2">Bridge Stats</h1>
        <p className="text-gray-400 text-sm">
          Bridge fee rate: {feePercent}% &middot; Fees auto-routed to feeRecipient
        </p>
      </div>

      <div className="bg-card rounded-2xl p-5 border border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-sans font-semibold text-gray-300">Per-Chain Stats</h2>
          <button
            onClick={refresh}
            disabled={loading}
            className="text-xs px-3 py-1 rounded-lg bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 transition-colors disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8">
            <div className="inline-block w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs border-b border-gray-800">
                  <th className="text-left pb-2 pr-3 font-medium">Chain</th>
                  <th className="text-right pb-2 pr-3 font-medium">Deposits</th>
                  <th className="text-right pb-2 pr-3 font-medium">Total Txs</th>
                  <th className="text-left pb-2 pr-3 font-medium">Fee Recipient</th>
                  <th className="text-right pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.chainId} className="border-b border-gray-800/50 last:border-0">
                    <td className="py-2.5 pr-3">
                      <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-accent/15 text-accent border border-accent/30">
                        {r.chainName}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-right text-gray-400 font-mono">
                      {r.deployed ? r.depositNonce : '—'}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-gray-400 font-mono">
                      {r.deployed ? r.txCount : '—'}
                    </td>
                    <td className="py-2.5 pr-3">
                      {r.deployed && r.feeRecipient !== '0x' + '0'.repeat(40) ? (
                        <span className="text-xs text-gray-400 font-mono">
                          {r.feeRecipient.slice(0, 8)}...{r.feeRecipient.slice(-6)}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-600">—</span>
                      )}
                    </td>
                    <td className="py-2.5 text-right">
                      {r.deployed ? (
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-green-500/15 text-green-400 border border-green-500/30">
                          Live
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-gray-500/15 text-gray-500 border border-gray-500/30">
                          Not Deployed
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
