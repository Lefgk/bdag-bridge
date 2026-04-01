'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { decodeEventLog, formatUnits } from 'viem';
import { PROSPERITY_BRIDGE_ABI } from '@/lib/abi';
import { CONTRACTS } from '@/config/contracts';
import { BRIDGE_TOKENS } from '@/config/tokens';
import { getRpc, rpcCall, isPlaceholderAddress } from '@/config/chainUtils';
import config from '@/config/bridge-config.json';

const RELAYER_API = '/api/relayer';

export interface BridgeTx {
  txHash: string;
  releaseTxHash: string;
  depositNumber: string;
  sourceChainId: number;
  destChainId: number;
  token: string;
  tokenSymbol: string;
  amount: string;
  receiver: string;
  timestamp: number;
  delivered: boolean;
  reverted: boolean;
}

function resolveTokenSymbol(tokenAddr: string, chainId: number): string {
  const addr = tokenAddr.toLowerCase();
  // Check the source chain first
  for (const t of BRIDGE_TOKENS) {
    const a = t.addresses[chainId];
    if (a && a.toLowerCase() === addr) return t.symbol;
  }
  // Fallback: check ALL chains in case the address matches a different chain entry
  for (const t of BRIDGE_TOKENS) {
    for (const cid of Object.keys(t.addresses)) {
      if (t.addresses[Number(cid)]?.toLowerCase() === addr) return t.symbol;
    }
  }
  // Show truncated address if unknown
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function resolveTokenDecimals(tokenAddr: string, chainId: number): number {
  const addr = tokenAddr.toLowerCase();
  for (const t of BRIDGE_TOKENS) {
    const a = t.addresses[chainId];
    if (a && a.toLowerCase() === addr) return t.decimals[chainId] ?? 18;
  }
  return 18;
}

/** Check releasedDeposits(sourceChainId, depositNumber) on destination bridge. */
async function checkDelivered(destChainId: number, sourceChainId: number, depositNumber: string): Promise<boolean> {
  const destBridge = CONTRACTS[destChainId]?.bridge;
  if (!destBridge || isPlaceholderAddress(destBridge)) return false;
  try {
    const destRpc = getRpc(destChainId);
    // releasedDeposits(uint256,uint256) selector = 0x047a7fe5
    const data = '0x047a7fe5' +
      BigInt(sourceChainId).toString(16).padStart(64, '0') +
      BigInt(depositNumber).toString(16).padStart(64, '0');
    const result = await rpcCall(destRpc, 'eth_call', [{ to: destBridge, data }, 'latest'], 5000);
    return !!(result && result !== '0x' + '0'.repeat(64));
  } catch {
    return false;
  }
}

export function useBridgeHistory() {
  const { address } = useAccount();
  const [txs, setTxs] = useState<BridgeTx[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const fetchHistory = useCallback(async () => {
    if (!address) { setTxs([]); return; }

    setLoading(true);
    setError(undefined);

    try {
      const res = await fetch(`${RELAYER_API}/history?address=${address}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`Relayer API error: ${res.status}`);
      const data = await res.json();
      const deposits: any[] = data.deposits || [];

      // Filter out entries with no useful data (old entries from previous bridge deployments)
      const validDeposits = deposits.filter((d: any) =>
        d.source_chain && d.target_chain && d.token && d.amount && d.deposit_tx
      );

      const results: BridgeTx[] = validDeposits.map((d: any) => {
        const sourceChainId = d.source_chain || 0;
        const destChainId = d.target_chain || 0;
        const tokenAddr = d.token || '';
        const symbol = resolveTokenSymbol(tokenAddr, sourceChainId);
        const decimals = resolveTokenDecimals(tokenAddr, sourceChainId);
        const rawAmount = d.amount || '0';
        const amount = formatUnits(BigInt(rawAmount), decimals);
        const rawReleaseTx = d.tx_hash || '';
        // Handle "reverted:0x..." format — extract the hash
        const revertedMatch = rawReleaseTx.match(/^reverted:(0x[0-9a-fA-F]{64})$/);
        const cleanReleaseTx = revertedMatch ? revertedMatch[1] : rawReleaseTx;
        const isRealHash = cleanReleaseTx.startsWith('0x') && cleanReleaseTx.length === 66;
        const isReverted = !!revertedMatch;
        const delivered = !!(rawReleaseTx && rawReleaseTx !== 'pending' && rawReleaseTx !== 'reverted' && rawReleaseTx !== 'already-released');
        const depositKey = d.key || '';
        const depositNumber = depositKey.includes('_') ? depositKey.split('_')[1] : '';

        return {
          txHash: d.deposit_tx || '',
          releaseTxHash: isRealHash ? cleanReleaseTx : '',
          depositNumber,
          sourceChainId,
          destChainId,
          token: tokenAddr,
          tokenSymbol: symbol,
          amount,
          receiver: d.receiver || '',
          timestamp: d.created_at || 0,
          delivered,
          reverted: isReverted,
        };
      });

      results.sort((a, b) => b.timestamp - a.timestamp);
      setTxs(results);
    } catch (err: any) {
      setError(err.message || 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  return { txs, loading, error, refetch: fetchHistory };
}

/** Lookup a deposit by tx hash — searches all chains for the receipt. */
export async function lookupDepositByTxHash(txHash: string): Promise<{
  sourceChainId: number;
  destChainId: number;
  depositNumber: string;
  tokenSymbol: string;
  amount: string;
  receiver: string;
  delivered: boolean;
} | null> {
  // Try relayer API first
  try {
    const res = await fetch(`${RELAYER_API}/check-tx/${txHash}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.depositNumber !== undefined) {
        const sourceChainId = data.sourceChainId || 0;
        const symbol = resolveTokenSymbol(data.token || '', sourceChainId);
        const decimals = resolveTokenDecimals(data.token || '', sourceChainId);
        return {
          sourceChainId,
          destChainId: data.destChainId || 0,
          depositNumber: String(data.depositNumber),
          tokenSymbol: symbol,
          amount: data.amount ? formatUnits(BigInt(data.amount), decimals) : '0',
          receiver: data.receiver || '',
          delivered: data.delivered || false,
        };
      }
    }
  } catch { /* fall through to on-chain scan */ }

  // Fallback: scan on-chain
  const chainIds = Object.keys(config.chains).map(Number);

  for (const chainId of chainIds) {
    try {
      const rpc = getRpc(chainId);
      const receipt = await rpcCall(rpc, 'eth_getTransactionReceipt', [txHash]);
      if (!receipt?.logs) continue;

      const bridge = CONTRACTS[chainId]?.bridge;
      if (!bridge) continue;

      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== bridge.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({ abi: PROSPERITY_BRIDGE_ABI, data: log.data, topics: log.topics });
          if (decoded.eventName === 'ERC20Deposited' || decoded.eventName === 'NativeDeposited') {
            const args = decoded.args as any;
            const depositNumber = String(args.depositNumber);
            const destChainId = Number(args.targetChainId);
            const amount = args.amount as bigint;
            const receiver = args.receiver as string;

            let tokenSymbol = 'Unknown';
            let decimals = 18;
            if (decoded.eventName === 'ERC20Deposited') {
              const tokenAddr = args.token as string;
              tokenSymbol = resolveTokenSymbol(tokenAddr, chainId);
              decimals = resolveTokenDecimals(tokenAddr, chainId);
            } else {
              tokenSymbol = 'Native';
            }

            const delivered = await checkDelivered(destChainId, chainId, depositNumber);

            return {
              sourceChainId: chainId,
              destChainId,
              depositNumber,
              tokenSymbol,
              amount: formatUnits(amount, decimals),
              receiver,
              delivered,
            };
          }
        } catch { /* skip */ }
      }
    } catch { /* try next chain */ }
  }
  return null;
}
