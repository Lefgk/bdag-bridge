'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount, useWriteContract, useSwitchChain } from 'wagmi';
import config from '@/config/bridge-config.json';
import {
  getRpc,
  rpcCall,
  getBlockNumber,
  chainLabel,
  explorerTxUrl,
} from '@/config/chainUtils';
import { formatUnits, parseUnits } from 'viem';

const FEE_RATE = 0.006;

// ERC20Deposited event topic
const ERC20_DEPOSITED_TOPIC =
  '0xd6e7f41ecbe30f60a5c6818a6a0e8bc6f14e610e6262c63c6521dda51a8fa907';

// Minimal ABIs for fee collection
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

// Derive chain IDs, tokens, and lookup from config
const CHAIN_IDS = Object.keys(config.chains).map(Number);

type TokenInfo = { symbol: string; decimals: number };
const tokenLookup: Record<string, TokenInfo> = {};
for (const token of config.tokens) {
  for (const [, chain] of Object.entries(token.addresses)) {
    const c = chain as { address: string; decimals: number };
    tokenLookup[c.address.toLowerCase()] = { symbol: token.symbol, decimals: c.decimals };
  }
}

interface DepositEvent {
  token: string;
  symbol: string;
  decimals: number;
  amount: bigint;
  sourceChainId: number;
  targetChainId: number;
  depositNumber: number;
  txHash: string;
  blockNumber: number;
  chainId: number;
}

// Per-chain per-token balance of bridge contract
interface BridgeBalance {
  chainId: number;
  chainName: string;
  symbol: string;
  decimals: number;
  tokenAddress: string;
  balance: bigint;
}

// Fee summary per chain per token
interface FeeSummary {
  chainId: number;
  chainName: string;
  symbol: string;
  decimals: number;
  tokenAddress: string;
  bridgeAddress: string;
  feeSplitter?: string;
  volume: bigint;
  fees: bigint;
  count: number;
  bridgeBalance: bigint;
}

function getChainConfig(chainId: number) {
  return config.chains[String(chainId) as keyof typeof config.chains];
}

async function fetchDepositLogs(
  chainId: number,
  bridgeAddress: string,
  fromBlock: number,
  toBlock: number,
  chunkSize: number
): Promise<DepositEvent[]> {
  const rpc = getRpc(chainId);
  const events: DepositEvent[] = [];

  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = Math.min(start + chunkSize - 1, toBlock);
    try {
      const logs = await rpcCall(rpc, 'eth_getLogs', [
        {
          address: bridgeAddress,
          topics: [ERC20_DEPOSITED_TOPIC],
          fromBlock: '0x' + start.toString(16),
          toBlock: '0x' + end.toString(16),
        },
      ]);

      for (const log of logs) {
        const tokenAddr = '0x' + (log.topics[1] as string).slice(26);
        const amount = BigInt(log.topics[2] as string);
        const data = log.data as string;
        const sourceChainId = Number(BigInt('0x' + data.slice(2, 66)));
        const targetChainId = Number(BigInt('0x' + data.slice(66, 130)));
        const depositNumber = Number(BigInt('0x' + data.slice(130, 194)));
        const info = tokenLookup[tokenAddr.toLowerCase()];

        events.push({
          token: tokenAddr,
          symbol: info?.symbol || 'UNKNOWN',
          decimals: info?.decimals || 18,
          amount,
          sourceChainId,
          targetChainId,
          depositNumber,
          txHash: log.transactionHash,
          blockNumber: Number(BigInt(log.blockNumber)),
          chainId,
        });
      }
    } catch (err) {
      console.warn(`Failed to fetch logs ${start}-${end} on chain ${chainId}:`, err);
    }
  }

  return events;
}

// Fetch ERC20 balanceOf via raw RPC
async function fetchBalance(chainId: number, tokenAddress: string, holderAddress: string): Promise<bigint> {
  const rpc = getRpc(chainId);
  const holderPadded = holderAddress.slice(2).toLowerCase().padStart(64, '0');
  const data = '0x70a08231' + holderPadded;
  try {
    const result = await rpcCall(rpc, 'eth_call', [{ to: tokenAddress, data }, 'latest']);
    return result && result !== '0x' ? BigInt(result) : 0n;
  } catch {
    return 0n;
  }
}

function formatTokenAmount(amount: bigint, decimals: number): string {
  const formatted = formatUnits(amount, decimals);
  const num = parseFloat(formatted);
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

export function FeesPanel() {
  const { address, chainId: walletChainId } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();

  const [deposits, setDeposits] = useState<DepositEvent[]>([]);
  const [bridgeBalances, setBridgeBalances] = useState<Record<string, bigint>>({});
  const [loading, setLoading] = useState(true);
  const [balancesLoading, setBalancesLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [progress, setProgress] = useState('');
  const [collectingKey, setCollectingKey] = useState<string>();
  const [collectStatus, setCollectStatus] = useState<string>();
  const [collectAmounts, setCollectAmounts] = useState<Record<string, string>>({});

  const isAdmin = address?.toLowerCase() === config.admin.toLowerCase();

  // Fetch bridge balances for all chains/tokens
  const fetchBridgeBalances = useCallback(async () => {
    setBalancesLoading(true);
    const balances: Record<string, bigint> = {};

    const promises: Promise<void>[] = [];
    for (const chainIdStr of Object.keys(config.chains)) {
      const chainId = Number(chainIdStr);
      const chain = getChainConfig(chainId);
      if (!chain) continue;
      const bridgeAddr = chain.contracts.bridgeERC20;

      for (const token of config.tokens) {
        const tokenChain = token.addresses[chainIdStr as keyof typeof token.addresses] as
          | { address: string; decimals: number }
          | undefined;
        if (!tokenChain) continue;

        const key = `${chainId}-${token.symbol}`;
        promises.push(
          fetchBalance(chainId, tokenChain.address, bridgeAddr).then((bal) => {
            balances[key] = bal;
          })
        );
      }
    }

    await Promise.all(promises);
    setBridgeBalances(balances);
    setBalancesLoading(false);
  }, []);

  // Fetch deposit events
  const fetchAllDeposits = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    setDeposits([]);

    try {
      const allEvents: DepositEvent[] = [];

      for (const chainIdStr of Object.keys(config.chains)) {
        const chainId = Number(chainIdStr);
        const chain = getChainConfig(chainId);
        if (!chain) continue;

        setProgress(`Fetching ${chain.label} block number...`);
        const rpc = getRpc(chainId);
        const latest = await getBlockNumber(rpc);
        // Scan last 50000 blocks (or from a known start block)
        const fromBlock = Math.max(0, latest - 50_000);
        const bridgeAddr = chain.contracts.bridgeERC20;

        setProgress(`Scanning ${chain.label} deposits...`);
        const events = await fetchDepositLogs(chainId, bridgeAddr, fromBlock, latest, 5000);
        allEvents.push(...events);
      }

      allEvents.sort((a, b) => b.blockNumber - a.blockNumber);
      setDeposits(allEvents);
      setProgress('');
    } catch (err: any) {
      setError(err.message || 'Failed to fetch deposit events');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAllDeposits();
    fetchBridgeBalances();
  }, [fetchAllDeposits, fetchBridgeBalances]);

  // Build fee summary: per chain per token
  const feeSummaries: FeeSummary[] = [];
  for (const chainIdStr of Object.keys(config.chains)) {
    const chainId = Number(chainIdStr);
    const chain = getChainConfig(chainId);
    if (!chain) continue;

    for (const token of config.tokens) {
      const tokenChain = token.addresses[chainIdStr as keyof typeof token.addresses] as
        | { address: string; decimals: number }
        | undefined;
      if (!tokenChain) continue;

      const key = `${chainId}-${token.symbol}`;
      const chainDeposits = deposits.filter(
        (d) => d.chainId === chainId && d.symbol === token.symbol
      );

      let volume = 0n;
      let fees = 0n;
      for (const d of chainDeposits) {
        volume += d.amount;
        fees += (d.amount * 6n) / 1000n;
      }

      feeSummaries.push({
        chainId,
        chainName: chain.label,
        symbol: token.symbol,
        decimals: tokenChain.decimals,
        tokenAddress: tokenChain.address,
        bridgeAddress: chain.contracts.bridgeERC20,
        feeSplitter: 'feeSplitter' in chain.contracts ? (chain.contracts as any).feeSplitter : undefined,
        volume,
        fees,
        count: chainDeposits.length,
        bridgeBalance: bridgeBalances[key] || 0n,
      });
    }
  }

  // Sort: chains with fees first, then by fees desc
  feeSummaries.sort((a, b) => {
    if (b.fees > a.fees) return 1;
    if (b.fees < a.fees) return -1;
    return a.chainName.localeCompare(b.chainName);
  });

  const totalTxCount = deposits.length;

  // Collect & distribute fees: 2 txs sequentially
  async function collectFees(summary: FeeSummary) {
    const key = `${summary.chainId}-${summary.symbol}`;
    const amountStr = collectAmounts[key];
    if (!amountStr || !address) return;

    try {
      setCollectingKey(key);
      setCollectStatus('Switching chain...');

      // Switch to the chain where fees are
      if (walletChainId !== summary.chainId) {
        await switchChainAsync({ chainId: summary.chainId });
      }

      const amount = parseUnits(amountStr, summary.decimals);
      const feeSplitterAddr = summary.feeSplitter;

      if (!feeSplitterAddr) {
        // No feeSplitter on this chain — just withdraw to admin
        setCollectStatus('Withdrawing fees to admin...');
        await writeContractAsync({
          address: summary.bridgeAddress as `0x${string}`,
          abi: BRIDGE_WITHDRAW_ABI,
          functionName: 'withdrawFees',
          args: [summary.tokenAddress as `0x${string}`, amount, address],
          ...chainGasOverrides(summary.chainId),
        });
        setCollectStatus('Done!');
      } else {
        // Step 1: Withdraw from bridge to FeeSplitter
        setCollectStatus('Step 1/2: Withdrawing to FeeSplitter...');
        await writeContractAsync({
          address: summary.bridgeAddress as `0x${string}`,
          abi: BRIDGE_WITHDRAW_ABI,
          functionName: 'withdrawFees',
          args: [summary.tokenAddress as `0x${string}`, amount, feeSplitterAddr as `0x${string}`],
          ...chainGasOverrides(summary.chainId),
        });

        // Step 2: Distribute from FeeSplitter
        setCollectStatus('Step 2/2: Distributing to wallets...');
        await writeContractAsync({
          address: feeSplitterAddr as `0x${string}`,
          abi: FEE_SPLITTER_DISTRIBUTE_ABI,
          functionName: 'distribute',
          args: [summary.tokenAddress as `0x${string}`, amount],
          ...chainGasOverrides(summary.chainId),
        });
        setCollectStatus('Done!');
      }

      // Refresh balances
      setTimeout(() => {
        fetchBridgeBalances();
        setCollectingKey(undefined);
        setCollectStatus(undefined);
        setCollectAmounts((prev) => ({ ...prev, [key]: '' }));
      }, 2000);
    } catch (err: any) {
      const msg = err.shortMessage || err.message;
      setCollectStatus(msg?.includes('User rejected') ? 'Cancelled' : `Error: ${msg}`);
      setTimeout(() => {
        setCollectingKey(undefined);
        setCollectStatus(undefined);
      }, 3000);
    }
  }

  // Recent 20 transactions
  const recent = deposits.slice(0, 20);

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-sans font-bold text-white mb-2">Bridge Fee Analytics</h1>
        <p className="text-gray-400 text-sm">Fee collection & bridge balances across all chains</p>
      </div>

      {loading && (
        <div className="bg-card rounded-2xl p-8 border border-gray-800 text-center">
          <div className="inline-block w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm mt-2">{progress || 'Loading...'}</p>
        </div>
      )}

      {error && (
        <div className="bg-card rounded-2xl p-5 border border-red-500/20">
          <p className="text-red-400 text-sm">{error}</p>
          <button
            onClick={fetchAllDeposits}
            className="mt-2 text-xs px-3 py-1 rounded-lg bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Stats Row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-card rounded-2xl p-5 border border-gray-800">
              <p className="text-gray-400 text-xs font-medium mb-1">Total Transactions</p>
              <p className="text-2xl font-mono font-bold text-white">{totalTxCount}</p>
            </div>
            <div className="bg-card rounded-2xl p-5 border border-gray-800">
              <p className="text-gray-400 text-xs font-medium mb-1">Fee Rate</p>
              <p className="text-2xl font-mono font-bold text-accent">{(FEE_RATE * 100).toFixed(1)}%</p>
            </div>
          </div>

          {/* Fees & Bridge Balances Table — per chain per token */}
          <div className="bg-card rounded-2xl p-5 border border-gray-800">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-sans font-semibold text-gray-300">
                Fees & Bridge Balances
              </h2>
              <button
                onClick={fetchBridgeBalances}
                disabled={balancesLoading}
                className="text-xs px-3 py-1 rounded-lg bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 transition-colors disabled:opacity-50"
              >
                {balancesLoading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 text-xs border-b border-gray-800">
                    <th className="text-left pb-2 pr-3 font-medium">Chain</th>
                    <th className="text-left pb-2 pr-3 font-medium">Token</th>
                    <th className="text-right pb-2 pr-3 font-medium">Txns</th>
                    <th className="text-right pb-2 pr-3 font-medium">Volume</th>
                    <th className="text-right pb-2 pr-3 font-medium">Fees Earned</th>
                    <th className="text-right pb-2 pr-3 font-medium">Bridge Balance</th>
                    {isAdmin && <th className="text-right pb-2 font-medium">Collect</th>}
                  </tr>
                </thead>
                <tbody>
                  {feeSummaries.map((s) => {
                    const key = `${s.chainId}-${s.symbol}`;
                    const isCollecting = collectingKey === key;
                    return (
                      <tr key={key} className="border-b border-gray-800/50 last:border-0">
                        <td className="py-2.5 pr-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs font-semibold whitespace-nowrap ${
                              s.chainId === 56
                                ? 'bg-[#F3BA2F]/15 text-[#F3BA2F] border border-[#F3BA2F]/30'
                                : 'bg-accent/15 text-accent border border-accent/30'
                            }`}
                          >
                            {s.chainName}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 text-white font-medium">{s.symbol}</td>
                        <td className="py-2.5 pr-3 text-right text-gray-400 font-mono">{s.count}</td>
                        <td className="py-2.5 pr-3 text-right text-white font-mono whitespace-nowrap">
                          {formatTokenAmount(s.volume, s.decimals)}
                        </td>
                        <td className="py-2.5 pr-3 text-right text-accent font-mono whitespace-nowrap">
                          {formatTokenAmount(s.fees, s.decimals)}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono whitespace-nowrap">
                          {balancesLoading ? (
                            <span className="text-gray-600">...</span>
                          ) : (
                            <span className={s.bridgeBalance > 0n ? 'text-green-400' : 'text-gray-600'}>
                              {formatTokenAmount(s.bridgeBalance, s.decimals)}
                            </span>
                          )}
                        </td>
                        {isAdmin && (
                          <td className="py-2.5 text-right">
                            {isCollecting ? (
                              <span className="text-xs text-yellow-400">{collectStatus}</span>
                            ) : (
                              <div className="flex items-center justify-end gap-1">
                                <input
                                  type="text"
                                  placeholder="amt"
                                  value={collectAmounts[key] || ''}
                                  onChange={(e) =>
                                    setCollectAmounts((prev) => ({ ...prev, [key]: e.target.value }))
                                  }
                                  className="w-20 px-2 py-1 rounded bg-gray-900 border border-gray-700 text-xs text-white font-mono focus:outline-none focus:border-accent"
                                />
                                <button
                                  onClick={() => collectFees(s)}
                                  disabled={!collectAmounts[key]}
                                  className="px-2 py-1 rounded text-xs bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 transition-colors disabled:opacity-30 whitespace-nowrap"
                                >
                                  {s.feeSplitter ? 'Collect' : 'Withdraw'}
                                </button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent Transactions */}
          <div className="bg-card rounded-2xl p-5 border border-gray-800">
            <h2 className="text-sm font-sans font-semibold text-gray-300 mb-4">
              Recent Deposits{deposits.length > 20 ? ' (last 20)' : ''}
            </h2>
            {recent.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-4">No deposit events found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 text-xs border-b border-gray-800">
                      <th className="text-left pb-2 pr-3 font-medium">Block</th>
                      <th className="text-left pb-2 pr-3 font-medium">Direction</th>
                      <th className="text-right pb-2 pr-3 font-medium">Amount</th>
                      <th className="text-right pb-2 pr-3 font-medium">Fee</th>
                      <th className="text-left pb-2 font-medium">Tx</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((d, i) => {
                      const fee = (d.amount * 6n) / 1000n;
                      const isBscSource = d.sourceChainId === 56;
                      const dirLabel = `${chainLabel(d.sourceChainId)} → ${chainLabel(d.targetChainId)}`;
                      return (
                        <tr key={`${d.txHash}-${i}`} className="border-b border-gray-800/50 last:border-0">
                          <td className="py-2.5 pr-3 text-gray-400 font-mono text-xs whitespace-nowrap">
                            #{d.blockNumber.toLocaleString()}
                          </td>
                          <td className="py-2.5 pr-3">
                            <span
                              className={`inline-block px-2 py-0.5 rounded text-xs font-semibold whitespace-nowrap ${
                                isBscSource
                                  ? 'bg-[#F3BA2F]/15 text-[#F3BA2F] border border-[#F3BA2F]/30'
                                  : 'bg-accent/15 text-accent border border-accent/30'
                              }`}
                            >
                              {dirLabel}
                            </span>
                          </td>
                          <td className="py-2.5 pr-3 text-right text-white font-mono whitespace-nowrap">
                            {formatTokenAmount(d.amount, d.decimals)} {d.symbol}
                          </td>
                          <td className="py-2.5 pr-3 text-right text-accent font-mono whitespace-nowrap">
                            {formatTokenAmount(fee, d.decimals)}
                          </td>
                          <td className="py-2.5">
                            <a
                              href={explorerTxUrl(d.txHash, d.chainId)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-accent hover:text-accent-dim text-xs font-mono"
                            >
                              {d.txHash.slice(0, 8)}...{d.txHash.slice(-6)}
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Contract Info — auto-generated from config */}
          <div className="bg-card rounded-2xl p-5 border border-gray-800">
            <h2 className="text-sm font-sans font-semibold text-gray-300 mb-3">Bridge Contracts</h2>
            <div className="space-y-2 text-xs">
              {CHAIN_IDS.map((cid) => {
                const chain = getChainConfig(cid);
                if (!chain) return null;
                const explorer = chain.explorer;
                return Object.entries(chain.contracts).map(([name, addr]) => (
                  <div key={`${cid}-${name}`} className="flex justify-between items-center">
                    <span className="text-gray-400">
                      {chain.label} {name}
                    </span>
                    <a
                      href={`${explorer}/address/${addr}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:text-accent-dim font-mono"
                    >
                      {addr}
                    </a>
                  </div>
                ));
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
