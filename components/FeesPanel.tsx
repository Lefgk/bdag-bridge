'use client';

import { useState, useEffect } from 'react';
import config from '@/config/bridge-config.json';
import {
  getRpc,
  rpcCall,
  getBlockNumber,
  chainLabel,
  explorerTxUrl,
  BSC_CHAIN_ID,
  BDAG_CHAIN_ID,
} from '@/config/chainUtils';
import { formatUnits } from 'viem';

const FEE_RATE = 0.006;

// ERC20Deposited event topic
const ERC20_DEPOSITED_TOPIC =
  '0xd6e7f41ecbe30f60a5c6818a6a0e8bc6f14e610e6262c63c6521dda51a8fa907';

// Build token lookup: lowercase address -> { symbol, decimals }
type TokenInfo = { symbol: string; decimals: number };
const tokenLookup: Record<string, TokenInfo> = {};
for (const token of config.tokens) {
  for (const [, chain] of Object.entries(token.addresses)) {
    const addr = (chain as { address: string; decimals: number }).address.toLowerCase();
    tokenLookup[addr] = {
      symbol: token.symbol,
      decimals: (chain as { address: string; decimals: number }).decimals,
    };
  }
}

interface DepositEvent {
  token: string;
  symbol: string;
  decimals: number;
  amount: bigint;
  receiver: string;
  sourceChainId: number;
  targetChainId: number;
  depositNumber: number;
  txHash: string;
  blockNumber: number;
  chainId: number; // which chain the event was on
}

interface TokenSummary {
  symbol: string;
  volume: bigint;
  decimals: number;
  fees: bigint;
  count: number;
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
        const receiver = '0x' + (log.topics[3] as string).slice(26);

        // Decode data: sourceChainId, targetChainId, depositNumber (3 x uint256)
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
          receiver,
          sourceChainId,
          targetChainId,
          depositNumber,
          txHash: log.transactionHash,
          blockNumber: Number(BigInt(log.blockNumber)),
          chainId,
        });
      }
    } catch (err) {
      console.warn(`Failed to fetch logs for blocks ${start}-${end} on chain ${chainId}:`, err);
    }
  }

  return events;
}

function formatTokenAmount(amount: bigint, decimals: number): string {
  const formatted = formatUnits(amount, decimals);
  const num = parseFloat(formatted);
  if (num === 0) return '0.0000000';
  if (num < 0.0001) return num.toFixed(7);
  return num.toFixed(4);
}

function formatDate(blockNumber: number): string {
  // We don't have timestamps from getLogs, just show block number
  return `#${blockNumber.toLocaleString()}`;
}

export function FeesPanel() {
  const [deposits, setDeposits] = useState<DepositEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [progress, setProgress] = useState('');

  useEffect(() => {
    fetchAllDeposits();
  }, []);

  async function fetchAllDeposits() {
    setLoading(true);
    setError(undefined);
    setDeposits([]);

    try {
      // BSC: last 50,000 blocks in 5000-block chunks
      setProgress('Fetching BSC block number...');
      const bscRpc = getRpc(BSC_CHAIN_ID);
      const bscLatest = await getBlockNumber(bscRpc);
      const bscFrom = bscLatest - 50_000;
      const bscBridge = config.chains['56'].contracts.bridgeERC20;

      setProgress('Scanning BSC deposits...');
      const bscEvents = await fetchDepositLogs(BSC_CHAIN_ID, bscBridge, bscFrom, bscLatest, 5000);

      // BlockDAG: from 0x17D000 to latest
      setProgress('Fetching BlockDAG block number...');
      const bdagRpc = getRpc(BDAG_CHAIN_ID);
      const bdagLatest = await getBlockNumber(bdagRpc);
      const bdagFrom = 0x17d000; // ~1,560,576
      const bdagBridge = config.chains['1404'].contracts.bridgeERC20;

      setProgress('Scanning BlockDAG deposits...');
      const bdagEvents = await fetchDepositLogs(BDAG_CHAIN_ID, bdagBridge, bdagFrom, bdagLatest, 5000);

      const allEvents = [...bscEvents, ...bdagEvents].sort(
        (a, b) => b.blockNumber - a.blockNumber
      );
      setDeposits(allEvents);
      setProgress('');
    } catch (err: any) {
      setError(err.message || 'Failed to fetch deposit events');
    } finally {
      setLoading(false);
    }
  }

  // Aggregate by token
  const tokenSummaries: Record<string, TokenSummary> = {};
  for (const d of deposits) {
    if (!tokenSummaries[d.symbol]) {
      tokenSummaries[d.symbol] = {
        symbol: d.symbol,
        volume: 0n,
        decimals: d.decimals,
        fees: 0n,
        count: 0,
      };
    }
    const s = tokenSummaries[d.symbol];
    s.volume += d.amount;
    // fee = amount * 0.006 = amount * 6 / 1000
    s.fees += (d.amount * 6n) / 1000n;
    s.count += 1;
  }

  // Order: show tokens with activity first
  const orderedTokens = Object.values(tokenSummaries).sort((a, b) => {
    if (b.volume > a.volume) return 1;
    if (b.volume < a.volume) return -1;
    return 0;
  });

  // Also show tokens with zero activity
  for (const token of config.tokens) {
    if (!tokenSummaries[token.symbol]) {
      orderedTokens.push({
        symbol: token.symbol,
        volume: 0n,
        decimals: 18,
        fees: 0n,
        count: 0,
      });
    }
  }

  const totalTxCount = deposits.length;

  // Recent 20 transactions
  const recent = deposits.slice(0, 20);

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-sans font-bold text-white mb-2">Bridge Fee Analytics</h1>
        <p className="text-gray-400 text-sm">Admin view — fee collection across all bridge contracts</p>
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

          {/* Token Summary Table */}
          <div className="bg-card rounded-2xl p-5 border border-gray-800">
            <h2 className="text-sm font-sans font-semibold text-gray-300 mb-4">Fees by Token</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 text-xs border-b border-gray-800">
                    <th className="text-left pb-2 pr-3 font-medium">Token</th>
                    <th className="text-right pb-2 pr-3 font-medium">Txns</th>
                    <th className="text-right pb-2 pr-3 font-medium">Volume</th>
                    <th className="text-right pb-2 font-medium">Fees Earned</th>
                  </tr>
                </thead>
                <tbody>
                  {orderedTokens.map((t) => (
                    <tr key={t.symbol} className="border-b border-gray-800/50 last:border-0">
                      <td className="py-2.5 pr-3 text-white font-medium">{t.symbol}</td>
                      <td className="py-2.5 pr-3 text-right text-gray-400 font-mono">{t.count}</td>
                      <td className="py-2.5 pr-3 text-right text-white font-mono">
                        {formatTokenAmount(t.volume, t.decimals)}
                      </td>
                      <td className="py-2.5 text-right text-accent font-mono">
                        {formatTokenAmount(t.fees, t.decimals)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent Transactions */}
          <div className="bg-card rounded-2xl p-5 border border-gray-800">
            <h2 className="text-sm font-sans font-semibold text-gray-300 mb-4">
              Recent Fee Transactions{deposits.length > 20 ? ' (last 20)' : ''}
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
                      const isBscSource = d.sourceChainId === BSC_CHAIN_ID;
                      const dirLabel = `${chainLabel(d.sourceChainId)} → ${chainLabel(d.targetChainId)}`;
                      return (
                        <tr key={`${d.txHash}-${i}`} className="border-b border-gray-800/50 last:border-0">
                          <td className="py-2.5 pr-3 text-gray-400 font-mono text-xs whitespace-nowrap">
                            {formatDate(d.blockNumber)}
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

          {/* Contract Info */}
          <div className="bg-card rounded-2xl p-5 border border-gray-800">
            <h2 className="text-sm font-sans font-semibold text-gray-300 mb-3">Fee Collection Contracts</h2>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">BSC Bridge</span>
                <a
                  href={`https://bscscan.com/address/${config.chains['56'].contracts.bridgeERC20}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:text-accent-dim font-mono"
                >
                  {config.chains['56'].contracts.bridgeERC20}
                </a>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">BSC FeeSplitter</span>
                <a
                  href={`https://bscscan.com/address/${config.chains['56'].contracts.feeSplitter}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:text-accent-dim font-mono"
                >
                  {config.chains['56'].contracts.feeSplitter}
                </a>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">BDAG Bridge</span>
                <a
                  href={`https://bdagscan.com/address/${config.chains['1404'].contracts.bridgeERC20}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:text-accent-dim font-mono"
                >
                  {config.chains['1404'].contracts.bridgeERC20}
                </a>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
