'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { decodeEventLog, formatUnits } from 'viem';
import { PROSPERITY_BRIDGE_ABI } from '@/lib/abi';
import { CONTRACTS } from '@/config/contracts';
import { BRIDGE_TOKENS } from '@/config/tokens';
import { getRpc, rpcCall, isPlaceholderAddress } from '@/config/chainUtils';
import config from '@/config/bridge-config.json';

const HISTORY_KEY = 'prosperity_bridge_history';

export interface BridgeTx {
  txHash: string;
  messageId: string;
  sourceChainId: number;
  destChainId: number;
  token: string;
  tokenSymbol: string;
  amount: string;
  receiver: string;
  timestamp: number;
  delivered: boolean;
}

function resolveTokenSymbol(tokenAddr: string, chainId: number): string {
  const addr = tokenAddr.toLowerCase();
  for (const t of BRIDGE_TOKENS) {
    const a = t.addresses[chainId];
    if (a && a.toLowerCase() === addr) return t.symbol;
  }
  return 'Unknown';
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
      const raw = localStorage.getItem(HISTORY_KEY);
      const history: any[] = raw ? JSON.parse(raw) : [];

      // Check delivery status for undelivered entries
      const results: BridgeTx[] = [];
      for (const h of history) {
        let delivered = h.delivered;

        // Re-check undelivered entries on-chain
        if (!delivered && h.messageId && h.destChainId && h.sourceChainId) {
          delivered = await checkDelivered(h.destChainId, h.sourceChainId, h.messageId);
        }

        results.push({
          txHash: h.txHash,
          messageId: h.messageId,
          sourceChainId: h.sourceChainId,
          destChainId: h.destChainId,
          token: h.token || '',
          tokenSymbol: h.tokenSymbol || 'Unknown',
          amount: h.amount || '-',
          receiver: h.receiver || '',
          timestamp: h.timestamp || 0,
          delivered,
        });
      }

      // Update localStorage with refreshed delivery statuses
      const updated = results.map(r => ({
        txHash: r.txHash,
        messageId: r.messageId,
        sourceChainId: r.sourceChainId,
        destChainId: r.destChainId,
        token: r.token,
        tokenSymbol: r.tokenSymbol,
        amount: r.amount,
        receiver: r.receiver,
        timestamp: r.timestamp,
        delivered: r.delivered,
      }));
      localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));

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
