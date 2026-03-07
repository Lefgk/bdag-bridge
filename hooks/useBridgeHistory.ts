'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { decodeEventLog, formatUnits, pad } from 'viem';
import { BRIDGE_ERC20_ABI } from '@/lib/abi';
import { CONTRACTS } from '@/config/contracts';
import { BRIDGE_TOKENS } from '@/config/tokens';
import { BSC_CHAIN_ID, BDAG_CHAIN_ID, getRpc, getDestChainId, rpcCall, getBlockNumber, RELAYER_API } from '@/config/chainUtils';

const BSC_BLOCK_CHUNK = 5000;
const BSC_BLOCK_RANGE = 50_000;

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

async function getBlockTimestamp(rpc: string, blockHex: string): Promise<number> {
  const block = await rpcCall(rpc, 'eth_getBlockByNumber', [blockHex, false]);
  return block ? parseInt(block.timestamp, 16) : 0;
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

async function checkReleased(sourceChainId: number, depositNumber: bigint): Promise<boolean> {
  const destChainId = getDestChainId(sourceChainId);
  const destRpc = getRpc(destChainId);
  const bridge = CONTRACTS[destChainId]?.bridgeERC20;
  if (!bridge) return false;

  const data = '0x047a7fe5' +
    sourceChainId.toString(16).padStart(64, '0') +
    depositNumber.toString(16).padStart(64, '0');

  const result = await rpcCall(destRpc, 'eth_call', [{ to: bridge, data }, 'latest']);
  return result && result !== '0x' + '0'.repeat(64);
}

// ERC20Released(address indexed token, uint256 indexed amount, address indexed receiver, uint256 depositChainId, uint256 depositNumber)
const ERC20_RELEASED_TOPIC = '0x6cd20a27d08ca93726a4abae8161aa3ce390af9a7755e6eaceba292199a81d19';

async function findReleaseTxHash(
  sourceChainId: number,
  depositNumber: bigint,
  _receiver: string,
  depositTxHash?: string,
): Promise<string | undefined> {
  const destChainId = getDestChainId(sourceChainId);
  const destRpc = getRpc(destChainId);
  const bridge = CONTRACTS[destChainId]?.bridgeERC20;
  if (!bridge) return undefined;

  // Method 1: Search on-chain logs by event signature only, match by depositNumber
  try {
    const latestBlock = await getBlockNumber(destRpc);
    const fromBlock = Math.max(0, latestBlock - 50_000);

    const chunkSize = destChainId === BSC_CHAIN_ID ? 5000 : 50_000;
    for (let from = fromBlock; from <= latestBlock; from += chunkSize) {
      const to = Math.min(from + chunkSize - 1, latestBlock);
      try {
        const logs = await rpcCall(destRpc, 'eth_getLogs', [{
          address: bridge,
          topics: [ERC20_RELEASED_TOPIC],
          fromBlock: '0x' + from.toString(16),
          toBlock: '0x' + to.toString(16),
        }]);

        for (const log of logs || []) {
          try {
            const decoded = decodeEventLog({ abi: BRIDGE_ERC20_ABI, data: log.data, topics: log.topics });
            if (decoded.eventName === 'ERC20Released') {
              const args = decoded.args as any;
              if (BigInt(args.depositNumber) === depositNumber &&
                  BigInt(args.depositChainId) === BigInt(sourceChainId)) {
                return log.transactionHash;
              }
            }
          } catch { /* skip */ }
        }
      } catch { /* skip chunk */ }
    }
  } catch { /* ignore */ }

  // Method 2: Fallback to relayer API
  if (depositTxHash) {
    try {
      const res = await fetch(`${RELAYER_API}/check-tx/${depositTxHash}`);
      const data = await res.json();
      if (data.releaseTxHash && data.releaseTxHash.startsWith('0x')) {
        return data.releaseTxHash;
      }
    } catch { /* ignore */ }
  }

  return undefined;
}

async function fetchDepositsFromChain(
  chainId: number,
  userAddress: string,
  blockRange: number,
): Promise<BridgeTx[]> {
  const rpc = getRpc(chainId);
  const bridge = CONTRACTS[chainId]?.bridgeERC20;
  if (!bridge) return [];

  const latestBlock = await getBlockNumber(rpc);
  const receiverTopic = pad(userAddress as `0x${string}`, { size: 32 });

  const allLogs: any[] = [];
  const startBlock = Math.max(0, latestBlock - blockRange);

  for (let from = startBlock; from <= latestBlock; from += BSC_BLOCK_CHUNK) {
    const to = Math.min(from + BSC_BLOCK_CHUNK - 1, latestBlock);
    try {
      const logs = await rpcCall(rpc, 'eth_getLogs', [{
        address: bridge,
        topics: [null, null, null, receiverTopic],
        fromBlock: '0x' + from.toString(16),
        toBlock: '0x' + to.toString(16),
      }]);
      allLogs.push(...(logs || []));
    } catch { /* skip failed chunks */ }
  }

  // Batch-fetch timestamps
  const blockNumbers = new Set<string>();
  for (const log of allLogs) blockNumbers.add(log.blockNumber);
  const blockArr = Array.from(blockNumbers);
  const timestampMap = new Map<string, number>();
  const batchSize = 20;
  for (let i = 0; i < blockArr.length; i += batchSize) {
    const batch = blockArr.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(bn => getBlockTimestamp(rpc, bn).catch(() => 0))
    );
    batch.forEach((bn, idx) => timestampMap.set(bn, results[idx]));
  }

  const txs: BridgeTx[] = [];
  for (const log of allLogs) {
    try {
      const decoded = decodeEventLog({ abi: BRIDGE_ERC20_ABI, data: log.data, topics: log.topics });
      if (decoded.eventName === 'ERC20Deposited') {
        const args = decoded.args as any;
        const tokenAddr = args.token as string;
        const amount = args.amount as bigint;
        const decimals = resolveTokenDecimals(tokenAddr, chainId);

        txs.push({
          depositTxHash: log.transactionHash,
          sourceChainId: Number(args.sourceChainId),
          targetChainId: Number(args.targetChainId),
          token: tokenAddr,
          tokenSymbol: resolveTokenSymbol(tokenAddr, chainId),
          amount: formatUnits(amount, decimals),
          depositNumber: args.depositNumber as bigint,
          timestamp: timestampMap.get(log.blockNumber),
          released: false,
        });
      }
    } catch { /* skip */ }
  }

  return txs;
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
      const [bscDeposits, bdagDeposits] = await Promise.all([
        fetchDepositsFromChain(BSC_CHAIN_ID, address, BSC_BLOCK_RANGE),
        fetchDepositsFromChain(BDAG_CHAIN_ID, address, BSC_BLOCK_RANGE),
      ]);

      const allDeposits = [...bscDeposits, ...bdagDeposits];

      // Check release status in parallel batches
      const batchSize = 10;
      for (let i = 0; i < allDeposits.length; i += batchSize) {
        const batch = allDeposits.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(tx => checkReleased(tx.sourceChainId, tx.depositNumber).catch(() => false))
        );
        batch.forEach((tx, idx) => { tx.released = results[idx]; });
      }

      // Find release tx hashes for released deposits
      const releasedDeposits = allDeposits.filter(tx => tx.released);
      if (releasedDeposits.length > 0) {
        const releaseBatch = 5;
        for (let i = 0; i < releasedDeposits.length; i += releaseBatch) {
          const batch = releasedDeposits.slice(i, i + releaseBatch);
          const hashes = await Promise.all(
            batch.map(tx => findReleaseTxHash(tx.sourceChainId, tx.depositNumber, address, tx.depositTxHash).catch(() => undefined))
          );
          batch.forEach((tx, idx) => { tx.releaseTxHash = hashes[idx]; });
        }
      }

      allDeposits.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
      setTxs(allDeposits);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch history');
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  return { txs, loading, error, refetch: fetchHistory };
}

// Standalone lookup by tx hash
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
  for (const chainId of [BSC_CHAIN_ID, BDAG_CHAIN_ID]) {
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

            const released = await checkReleased(sourceChainId, depositNumber);
            let releaseTxHash: string | undefined;
            if (released) {
              releaseTxHash = await findReleaseTxHash(sourceChainId, depositNumber, receiver);
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
