'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { decodeEventLog, formatUnits } from 'viem';
import { BRIDGE_ERC20_ABI } from '@/lib/abi';
import { CONTRACTS } from '@/config/contracts';
import { BRIDGE_TOKENS } from '@/config/tokens';
import { BSC_CHAIN_ID, BDAG_CHAIN_ID, getRpc, getDestChainId, rpcCall, RELAYER_API } from '@/config/chainUtils';
import config from '@/config/bridge-config.json';

export interface BridgeTx {
  depositTxHash: string;
  releaseTxHash?: string;
  sourceChainId: number;
  targetChainId: number;
  token: string;
  tokenSymbol: string;
  amount: string;
  depositNumber: bigint;
  timestamp?: number;
  released: boolean;
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
      const res = await fetch(`${RELAYER_API}/history?address=${address}`);
      if (!res.ok) throw new Error('Relayer offline');
      const data = await res.json();
      const deposits: any[] = data.deposits || [];

      const results: BridgeTx[] = [];

      for (const d of deposits) {
        const [srcStr, depStr] = d.key.split('_');
        const sourceChainId = Number(srcStr);
        const depositNumber = BigInt(depStr);

        const txHash = d.tx_hash || '';
        const isGoodRelease = txHash.startsWith('0x') && !txHash.startsWith('reverted:') && !txHash.startsWith('unconfirmed:') && txHash !== 'already-released';
        const releaseTxHash = isGoodRelease ? txHash : undefined;
        const released = isGoodRelease || txHash === 'already-released';

        let amount = '-';
        let tokenSymbol = '-';
        if (d.token && d.amount) {
          try {
            const decimals = resolveTokenDecimals(d.token, sourceChainId);
            amount = formatUnits(BigInt(d.amount), decimals);
            tokenSymbol = resolveTokenSymbol(d.token, sourceChainId);
          } catch { /* keep defaults */ }
        }

        results.push({
          depositTxHash: d.deposit_tx || '',
          releaseTxHash,
          sourceChainId,
          targetChainId: d.target_chain || getDestChainId(sourceChainId),
          token: d.token || '',
          tokenSymbol,
          amount,
          depositNumber,
          timestamp: d.created_at || undefined,
          released,
        });
      }

      results.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
      setTxs(results);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch history');
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  return { txs, loading, error, refetch: fetchHistory };
}

// Standalone lookup by tx hash — still uses on-chain receipt (fast, single tx)
export async function lookupDepositByTxHash(txHash: string): Promise<{
  sourceChainId: number;
  targetChainId: number;
  depositNumber: bigint;
  tokenSymbol: string;
  amount: string;
  receiver: string;
  released: boolean;
  releaseTxHash?: string;
} | null> {
  const chainIds = Object.keys(config.chains).map(Number);
  for (const chainId of chainIds) {
    try {
      const rpc = getRpc(chainId);
      const receipt = await rpcCall(rpc, 'eth_getTransactionReceipt', [txHash]);
      if (!receipt?.logs) continue;

      const bridge = CONTRACTS[chainId]?.bridgeERC20;
      if (!bridge) continue;

      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== bridge.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({ abi: BRIDGE_ERC20_ABI, data: log.data, topics: log.topics });
          if (decoded.eventName === 'ERC20Deposited') {
            const args = decoded.args as any;
            const depositNumber = args.depositNumber as bigint;
            const sourceChainId = Number(args.sourceChainId);
            const targetChainId = Number(args.targetChainId);
            const tokenAddr = args.token as string;
            const amount = args.amount as bigint;
            const receiver = args.receiver as string;
            const decimals = resolveTokenDecimals(tokenAddr, chainId);

            // Check release status via on-chain call
            const destChainId = getDestChainId(sourceChainId);
            const destRpc = getRpc(destChainId);
            const destBridge = CONTRACTS[destChainId]?.bridgeERC20;
            let released = false;
            let releaseTxHash: string | undefined;

            if (destBridge) {
              const data = '0x047a7fe5' +
                sourceChainId.toString(16).padStart(64, '0') +
                depositNumber.toString(16).padStart(64, '0');
              const result = await rpcCall(destRpc, 'eth_call', [{ to: destBridge, data }, 'latest']);
              released = result && result !== '0x' + '0'.repeat(64);
            }

            // Try relayer API for release tx hash
            if (released) {
              try {
                const res = await fetch(`${RELAYER_API}/check-tx/${txHash}`);
                const d = await res.json();
                if (d.releaseTxHash?.startsWith('0x')) releaseTxHash = d.releaseTxHash;
              } catch {}
            }

            return {
              sourceChainId,
              targetChainId,
              depositNumber,
              tokenSymbol: resolveTokenSymbol(tokenAddr, chainId),
              amount: formatUnits(amount, decimals),
              receiver,
              released,
              releaseTxHash,
            };
          }
        } catch { /* skip */ }
      }
    } catch { /* try next chain */ }
  }
  return null;
}
