'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount, useWriteContract, useSwitchChain } from 'wagmi';
import config from '@/config/bridge-config.json';
import { getRpc, rpcCall, getBlockNumber } from '@/config/chainUtils';
import { formatUnits } from 'viem';

const ERC20_DEPOSITED_TOPIC =
  '0xd6e7f41ecbe30f60a5c6818a6a0e8bc6f14e610e6262c63c6521dda51a8fa907';

const BRIDGE_WITHDRAW_ABI = [
  {
    inputs: [
      { name: '_token', type: 'address' },
      { name: '_amount', type: 'uint256' },
      { name: '_to', type: 'address' },
    ],
    name: 'withdrawFees',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

const FEE_SPLITTER_DISTRIBUTE_ABI = [
  {
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'distribute',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

type TokenInfo = { symbol: string; decimals: number };
const tokenLookup: Record<string, TokenInfo> = {};
for (const token of config.tokens) {
  for (const [, chain] of Object.entries(token.addresses)) {
    const c = chain as { address: string; decimals: number };
    tokenLookup[c.address.toLowerCase()] = { symbol: token.symbol, decimals: c.decimals };
  }
}

function getChainConfig(chainId: number) {
  return config.chains[String(chainId) as keyof typeof config.chains];
}

async function fetchBalance(chainId: number, tokenAddress: string, holderAddress: string): Promise<bigint> {
  const rpc = getRpc(chainId);
  const data = '0x70a08231' + holderAddress.slice(2).toLowerCase().padStart(64, '0');
  try {
    const result = await rpcCall(rpc, 'eth_call', [{ to: tokenAddress, data }, 'latest']);
    return result && result !== '0x' ? BigInt(result) : 0n;
  } catch {
    return 0n;
  }
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

interface Row {
  chainId: number;
  chainName: string;
  symbol: string;
  decimals: number;
  tokenAddress: string;
  bridgeAddress: string;
  feeSplitter?: string;
  fees: bigint;
  bridgeBalance: bigint;
  count: number;
}

export function FeesPanel() {
  const { address, chainId: walletChainId } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [collectingKey, setCollectingKey] = useState<string>();
  const [collectStatus, setCollectStatus] = useState<string>();

  const isAdmin = address?.toLowerCase() === config.admin.toLowerCase();

  const refresh = useCallback(async () => {
    setLoading(true);
    const result: Row[] = [];

    for (const chainIdStr of Object.keys(config.chains)) {
      const chainId = Number(chainIdStr);
      const chain = getChainConfig(chainId);
      if (!chain) continue;

      const rpc = getRpc(chainId);
      const bridgeAddr = chain.contracts.bridgeERC20;

      // Fetch deposit counts for fee estimation
      let deposits: { token: string; amount: bigint }[] = [];
      try {
        const latest = await getBlockNumber(rpc);
        const from = Math.max(0, latest - 50_000);
        for (let start = from; start <= latest; start += 5000) {
          const end = Math.min(start + 4999, latest);
          try {
            const logs = await rpcCall(rpc, 'eth_getLogs', [{
              address: bridgeAddr,
              topics: [ERC20_DEPOSITED_TOPIC],
              fromBlock: '0x' + start.toString(16),
              toBlock: '0x' + end.toString(16),
            }]);
            for (const log of logs) {
              deposits.push({
                token: ('0x' + (log.topics[1] as string).slice(26)).toLowerCase(),
                amount: BigInt(log.topics[2] as string),
              });
            }
          } catch { /* skip chunk */ }
        }
      } catch { /* skip chain */ }

      // Build rows per token
      for (const token of config.tokens) {
        const tc = token.addresses[chainIdStr as keyof typeof token.addresses] as
          | { address: string; decimals: number }
          | undefined;
        if (!tc) continue;

        const tokenDeposits = deposits.filter(d => d.token === tc.address.toLowerCase());
        let fees = 0n;
        for (const d of tokenDeposits) fees += (d.amount * 6n) / 1000n;

        const balance = await fetchBalance(chainId, tc.address, bridgeAddr);

        result.push({
          chainId,
          chainName: chain.label,
          symbol: token.symbol,
          decimals: tc.decimals,
          tokenAddress: tc.address,
          bridgeAddress: bridgeAddr,
          feeSplitter: 'feeSplitter' in chain.contracts ? (chain.contracts as any).feeSplitter : undefined,
          fees,
          bridgeBalance: balance,
          count: tokenDeposits.length,
        });
      }
    }

    result.sort((a, b) => (b.fees > a.fees ? 1 : b.fees < a.fees ? -1 : 0));
    setRows(result);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function distribute(row: Row) {
    if (!address || row.fees === 0n) return;
    const key = `${row.chainId}-${row.symbol}`;

    try {
      setCollectingKey(key);

      if (walletChainId !== row.chainId) {
        setCollectStatus('Switching chain...');
        await switchChainAsync({ chainId: row.chainId });
      }

      // Use the estimated fees as the amount to withdraw
      const amount = row.fees;

      if (!row.feeSplitter) {
        setCollectStatus('Withdrawing fees...');
        await writeContractAsync({
          address: row.bridgeAddress as `0x${string}`,
          abi: BRIDGE_WITHDRAW_ABI,
          functionName: 'withdrawFees',
          args: [row.tokenAddress as `0x${string}`, amount, address],
          ...chainGasOverrides(row.chainId),
        });
      } else {
        setCollectStatus('1/2 Withdraw to splitter...');
        await writeContractAsync({
          address: row.bridgeAddress as `0x${string}`,
          abi: BRIDGE_WITHDRAW_ABI,
          functionName: 'withdrawFees',
          args: [row.tokenAddress as `0x${string}`, amount, row.feeSplitter as `0x${string}`],
          ...chainGasOverrides(row.chainId),
        });

        setCollectStatus('2/2 Distributing...');
        await writeContractAsync({
          address: row.feeSplitter as `0x${string}`,
          abi: FEE_SPLITTER_DISTRIBUTE_ABI,
          functionName: 'distribute',
          args: [row.tokenAddress as `0x${string}`, amount],
          ...chainGasOverrides(row.chainId),
        });
      }

      setCollectStatus('Done!');
      setTimeout(() => { setCollectingKey(undefined); setCollectStatus(undefined); refresh(); }, 2000);
    } catch (err: any) {
      const msg = err.shortMessage || err.message;
      setCollectStatus(msg?.includes('User rejected') ? 'Cancelled' : `Error: ${msg}`);
      setTimeout(() => { setCollectingKey(undefined); setCollectStatus(undefined); }, 3000);
    }
  }

  if (!isAdmin) {
    return (
      <div className="bg-card rounded-2xl p-8 border border-gray-800 text-center">
        <p className="text-gray-400">Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-sans font-bold text-white mb-2">Fee Distribution</h1>
        <p className="text-gray-400 text-sm">Collect and distribute bridge fees</p>
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
                  <th className="text-right pb-2 pr-3 font-medium">Txns</th>
                  <th className="text-right pb-2 pr-3 font-medium">Fees</th>
                  <th className="text-right pb-2 pr-3 font-medium">Bridge Balance</th>
                  <th className="text-right pb-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const key = `${r.chainId}-${r.symbol}`;
                  const isCollecting = collectingKey === key;
                  return (
                    <tr key={key} className="border-b border-gray-800/50 last:border-0">
                      <td className="py-2.5 pr-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                          r.chainId === 56
                            ? 'bg-[#F3BA2F]/15 text-[#F3BA2F] border border-[#F3BA2F]/30'
                            : 'bg-accent/15 text-accent border border-accent/30'
                        }`}>
                          {r.chainName}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-white font-medium">{r.symbol}</td>
                      <td className="py-2.5 pr-3 text-right text-gray-400 font-mono">{r.count}</td>
                      <td className="py-2.5 pr-3 text-right text-accent font-mono whitespace-nowrap">
                        {fmt(r.fees, r.decimals)}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono whitespace-nowrap">
                        <span className={r.bridgeBalance > 0n ? 'text-green-400' : 'text-gray-600'}>
                          {fmt(r.bridgeBalance, r.decimals)}
                        </span>
                      </td>
                      <td className="py-2.5 text-right">
                        {isCollecting ? (
                          <span className="text-xs text-yellow-400">{collectStatus}</span>
                        ) : (
                          <button
                            onClick={() => distribute(r)}
                            disabled={r.fees === 0n}
                            className="px-3 py-1 rounded text-xs bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 transition-colors disabled:opacity-30 whitespace-nowrap"
                          >
                            Distribute
                          </button>
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
