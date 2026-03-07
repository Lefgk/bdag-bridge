'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount, useWriteContract, useSwitchChain } from 'wagmi';
import config from '@/config/bridge-config.json';
import { getRpc, rpcCall } from '@/config/chainUtils';
import { formatUnits } from 'viem';

const BRIDGE_DISTRIBUTE_FEES_ABI = [
  {
    inputs: [{ name: '_token', type: 'address' }],
    name: 'distributeFees',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

// ── On-chain read helpers ────────────────────────────────────────────────────

async function ethCall(chainId: number, to: string, data: string): Promise<string> {
  const rpc = getRpc(chainId);
  const result = await rpcCall(rpc, 'eth_call', [{ to, data }, 'latest']);
  return result && result !== '0x' ? result : '0x' + '0'.repeat(64);
}

function encodeAddress(addr: string): string {
  return addr.slice(2).toLowerCase().padStart(64, '0');
}

async function fetchBalance(chainId: number, token: string, holder: string): Promise<bigint> {
  try {
    const result = await ethCall(chainId, token, '0x70a08231' + encodeAddress(holder));
    return BigInt(result);
  } catch { return 0n; }
}

async function fetchAccumulatedFees(chainId: number, bridge: string, token: string): Promise<bigint> {
  try {
    const result = await ethCall(chainId, bridge, '0xfcf66664' + encodeAddress(token));
    return BigInt(result);
  } catch { return 0n; }
}

async function fetchDepositCount(chainId: number, bridge: string): Promise<number> {
  try {
    const result = await ethCall(chainId, bridge, '0x2dfdf0b5');
    return Number(BigInt(result));
  } catch { return 0; }
}

async function fetchFeeSplitter(chainId: number, bridge: string): Promise<string> {
  try {
    const result = await ethCall(chainId, bridge, '0x6052970c');
    return '0x' + result.slice(-40);
  } catch { return '0x' + '0'.repeat(40); }
}

async function fetchDefaultFeeRate(chainId: number, bridge: string): Promise<bigint> {
  try {
    const result = await ethCall(chainId, bridge, '0x6ced0c92');
    return BigInt(result);
  } catch { return 0n; }
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

function chainGasOverrides(chainId: number) {
  const chain = getChainConfig(chainId);
  if (chain && 'gasPrice' in chain && chain.gasPrice) {
    return { gasPrice: BigInt(chain.gasPrice as number) };
  }
  return {};
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Row {
  chainId: number;
  chainName: string;
  symbol: string;
  decimals: number;
  tokenAddress: string;
  bridgeAddress: string;
  accumulatedFees: bigint;
  bridgeBalance: bigint;
  depositCount: number;
  feeMode: 'auto' | 'manual' | 'burned';
  feeRatePpm: bigint;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function FeesPanel() {
  const { address, chainId: walletChainId } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [collectingKey, setCollectingKey] = useState<string>();
  const [collectStatus, setCollectStatus] = useState<string>();

  const refresh = useCallback(async () => {
    setLoading(true);
    const result: Row[] = [];

    for (const chainIdStr of Object.keys(config.chains)) {
      const chainId = Number(chainIdStr);
      const chain = getChainConfig(chainId);
      if (!chain) continue;

      const bridgeAddr = chain.contracts.bridgeERC20;
      const isBDAG = chainId === 1404;

      // Fetch chain-level data
      const [depositCount, feeSplitterAddr, defaultFeeRate] = await Promise.all([
        fetchDepositCount(chainId, bridgeAddr),
        fetchFeeSplitter(chainId, bridgeAddr),
        fetchDefaultFeeRate(chainId, bridgeAddr),
      ]);

      const hasFeeSplitter = feeSplitterAddr !== '0x' + '0'.repeat(40);
      const feeMode: Row['feeMode'] = isBDAG ? 'burned' : hasFeeSplitter ? 'auto' : 'manual';

      // Fetch per-token data
      for (const token of config.tokens) {
        const tc = token.addresses[chainIdStr as keyof typeof token.addresses] as
          | { address: string; decimals: number }
          | undefined;
        if (!tc) continue;

        const [balance, accumulated] = await Promise.all([
          fetchBalance(chainId, tc.address, bridgeAddr),
          fetchAccumulatedFees(chainId, bridgeAddr, tc.address),
        ]);

        result.push({
          chainId,
          chainName: chain.label,
          symbol: token.symbol,
          decimals: tc.decimals,
          tokenAddress: tc.address,
          bridgeAddress: bridgeAddr,
          accumulatedFees: accumulated,
          bridgeBalance: balance,
          depositCount,
          feeMode,
          feeRatePpm: defaultFeeRate,
        });
      }
    }

    // Sort: claimable fees first, then by balance
    result.sort((a, b) => {
      if (a.accumulatedFees > 0n && b.accumulatedFees === 0n) return -1;
      if (a.accumulatedFees === 0n && b.accumulatedFees > 0n) return 1;
      return b.bridgeBalance > a.bridgeBalance ? 1 : b.bridgeBalance < a.bridgeBalance ? -1 : 0;
    });
    setRows(result);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function distribute(row: Row) {
    if (!address || row.accumulatedFees === 0n) return;
    const key = `${row.chainId}-${row.symbol}`;

    try {
      setCollectingKey(key);

      if (walletChainId !== row.chainId) {
        setCollectStatus('Switching chain...');
        await switchChainAsync({ chainId: row.chainId });
      }

      setCollectStatus('Distributing fees...');
      await writeContractAsync({
        address: row.bridgeAddress as `0x${string}`,
        abi: BRIDGE_DISTRIBUTE_FEES_ABI,
        functionName: 'distributeFees',
        args: [row.tokenAddress as `0x${string}`],
        ...chainGasOverrides(row.chainId),
      });

      setCollectStatus('Done!');
      setTimeout(() => { setCollectingKey(undefined); setCollectStatus(undefined); refresh(); }, 2000);
    } catch (err: any) {
      const msg = err.shortMessage || err.message;
      setCollectStatus(msg?.includes('User rejected') ? 'Cancelled' : `Error: ${msg}`);
      setTimeout(() => { setCollectingKey(undefined); setCollectStatus(undefined); }, 3000);
    }
  }

  function feeStatusLabel(r: Row): { label: string; color: string } {
    if (r.feeMode === 'burned') return { label: 'Burned (not minted)', color: 'text-gray-500' };
    if (r.accumulatedFees > 0n) return { label: fmt(r.accumulatedFees, r.decimals), color: 'text-accent' };
    if (r.feeMode === 'auto') return { label: 'Auto-distributed', color: 'text-green-500' };
    return { label: '0', color: 'text-gray-600' };
  }

  const feePercent = rows.length > 0 ? (Number(rows[0].feeRatePpm) / 10000).toFixed(2) : '0.60';

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-sans font-bold text-white mb-2">Fee Distribution</h1>
        <p className="text-gray-400 text-sm">
          Bridge fee rate: {feePercent}% &middot; All data read on-chain
        </p>
      </div>

      <div className="bg-card rounded-2xl p-5 border border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-sans font-semibold text-gray-300">Bridge Fees</h2>
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
                  <th className="text-left pb-2 pr-3 font-medium">Token</th>
                  <th className="text-right pb-2 pr-3 font-medium">Deposits</th>
                  <th className="text-right pb-2 pr-3 font-medium">Claimable Fees</th>
                  <th className="text-right pb-2 pr-3 font-medium">Bridge Balance</th>
                  <th className="text-right pb-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const key = `${r.chainId}-${r.symbol}`;
                  const isCollecting = collectingKey === key;
                  const status = feeStatusLabel(r);
                  const canDistribute = r.accumulatedFees > 0n;
                  const chainColor = r.chainId === 56
                    ? 'bg-[#F3BA2F]/15 text-[#F3BA2F] border border-[#F3BA2F]/30'
                    : r.chainId === 81457
                    ? 'bg-[#FCFC03]/15 text-[#FCFC03] border border-[#FCFC03]/30'
                    : 'bg-accent/15 text-accent border border-accent/30';
                  return (
                    <tr key={key} className="border-b border-gray-800/50 last:border-0">
                      <td className="py-2.5 pr-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${chainColor}`}>
                          {r.chainName}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-white font-medium">{r.symbol}</td>
                      <td className="py-2.5 pr-3 text-right text-gray-400 font-mono">{r.depositCount}</td>
                      <td className="py-2.5 pr-3 text-right font-mono whitespace-nowrap">
                        <span className={status.color}>{status.label}</span>
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono whitespace-nowrap">
                        <span className={r.bridgeBalance > 0n ? 'text-green-400' : 'text-gray-600'}>
                          {fmt(r.bridgeBalance, r.decimals)}
                        </span>
                      </td>
                      <td className="py-2.5 text-right">
                        {isCollecting ? (
                          <span className="text-xs text-yellow-400">{collectStatus}</span>
                        ) : canDistribute ? (
                          <button
                            onClick={() => distribute(r)}
                            className="px-3 py-1 rounded text-xs bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 transition-colors whitespace-nowrap"
                          >
                            Distribute
                          </button>
                        ) : (
                          <span className="text-xs text-gray-600">&mdash;</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
