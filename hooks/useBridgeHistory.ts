'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { decodeEventLog, formatUnits, pad, toHex } from 'viem';
import { BRIDGE_ERC20_ABI } from '@/lib/abi';
import { CONTRACTS } from '@/config/contracts';
import { BRIDGE_TOKENS } from '@/config/tokens';

const BSC_RPC = 'https://bsc-rpc.publicnode.com';
const BDAG_RPC = 'https://rpc.bdagscan.com';
const BSC_CHAIN_ID = 56;
const BDAG_CHAIN_ID = 1404;
const BSC_BLOCK_CHUNK = 5000;
const BSC_BLOCK_RANGE = 50_000;

export interface BridgeTx {
  depositTxHash: string;
  releaseTxHash?: string;
  sourceChainId: number;
  targetChainId: number;
  token: string; // address
  tokenSymbol: string;
  amount: string; // formatted
  depositNumber: bigint;
  timestamp?: number;
  released: boolean;
}

// ERC20Deposited event topic
const ERC20_DEPOSITED_TOPIC = '0x' + 'a0785ec3' + // This is computed from the event sig
  ''; // We'll compute it properly below

// Compute event signature topic from ABI
function getEventTopic(eventName: string): string {
  // keccak256 of event signature
  if (eventName === 'ERC20Deposited') {
    // ERC20Deposited(address,uint256,address,uint256,uint256,uint256)
    // Pre-computed keccak256:
    return '0x6012dbaf85a74a01b7a5e08e21e76a0e582cb472e04ad553150c60a5581f7a06';
  }
  if (eventName === 'ERC20Released') {
    // ERC20Released(address,uint256,address,uint256,uint256)
    return '0x6fde25b2af2e3dd77a63d5cb2ee6e18d0c4a3bd2f4f82e48c4acb0c4b7c2c9d4';
  }
  return '0x';
}

async function rpcCall(rpc: string, method: string, params: any[]): Promise<any> {
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

async function getBlockNumber(rpc: string): Promise<number> {
  const hex = await rpcCall(rpc, 'eth_blockNumber', []);
  return parseInt(hex, 16);
}

async function getBlockTimestamp(rpc: string, blockHex: string): Promise<number> {
  const block = await rpcCall(rpc, 'eth_getBlockByNumber', [blockHex, false]);
  return block ? parseInt(block.timestamp, 16) : 0;
}

async function getLogs(rpc: string, params: {
  address: string;
  topics: (string | null)[];
  fromBlock: string;
  toBlock: string;
}): Promise<any[]> {
  return await rpcCall(rpc, 'eth_getLogs', [params]);
}

async function getTransactionReceipt(rpc: string, txHash: string): Promise<any> {
  return await rpcCall(rpc, 'eth_getTransactionReceipt', [txHash]);
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

// Check if a deposit has been released on destination chain
async function checkReleased(sourceChainId: number, depositNumber: bigint): Promise<boolean> {
  // Releases happen on the destination chain
  const destChainId = sourceChainId === BSC_CHAIN_ID ? BDAG_CHAIN_ID : BSC_CHAIN_ID;
  const destRpc = destChainId === BDAG_CHAIN_ID ? BDAG_RPC : BSC_RPC;
  const bridge = CONTRACTS[destChainId]?.bridgeERC20;
  if (!bridge) return false;

  const data = '0xa06e12e8' +
    sourceChainId.toString(16).padStart(64, '0') +
    depositNumber.toString(16).padStart(64, '0');

  const result = await rpcCall(destRpc, 'eth_call', [{ to: bridge, data }, 'latest']);
  return result && result !== '0x' + '0'.repeat(64);
}

// Fetch ERC20Released logs to find the release tx hash
async function findReleaseTxHash(
  sourceChainId: number,
  depositNumber: bigint,
  receiver: string,
): Promise<string | undefined> {
  const destChainId = sourceChainId === BSC_CHAIN_ID ? BDAG_CHAIN_ID : BSC_CHAIN_ID;
  const destRpc = destChainId === BDAG_CHAIN_ID ? BDAG_RPC : BSC_RPC;
  const bridge = CONTRACTS[destChainId]?.bridgeERC20;
  if (!bridge) return undefined;

  try {
    // ERC20Released has receiver as indexed topic 3
    const receiverTopic = pad(receiver as `0x${string}`, { size: 32 });
    const latestBlock = await getBlockNumber(destRpc);
    // Search last 50k blocks on destination chain
    const fromBlock = Math.max(0, latestBlock - 50_000);

    const logs = await getLogs(destRpc, {
      address: bridge,
      topics: [null, null, null, receiverTopic],
      fromBlock: '0x' + fromBlock.toString(16),
      toBlock: '0x' + latestBlock.toString(16),
    });

    for (const log of logs) {
      try {
        const decoded = decodeEventLog({
          abi: BRIDGE_ERC20_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === 'ERC20Released') {
          const args = decoded.args as any;
          if (BigInt(args.depositNumber) === depositNumber &&
              BigInt(args.depositChainId) === BigInt(sourceChainId)) {
            return log.transactionHash;
          }
        }
      } catch {
        // skip non-matching logs
      }
    }
  } catch {
    // ignore errors finding release tx
  }
  return undefined;
}

async function fetchDepositsFromChain(
  rpc: string,
  chainId: number,
  userAddress: string,
  blockRange: number,
): Promise<BridgeTx[]> {
  const bridge = CONTRACTS[chainId]?.bridgeERC20;
  if (!bridge) return [];

  const latestBlock = await getBlockNumber(rpc);
  const receiverTopic = pad(userAddress as `0x${string}`, { size: 32 });

  const allLogs: any[] = [];
  const startBlock = Math.max(0, latestBlock - blockRange);

  // Paginate in chunks
  for (let from = startBlock; from <= latestBlock; from += BSC_BLOCK_CHUNK) {
    const to = Math.min(from + BSC_BLOCK_CHUNK - 1, latestBlock);
    try {
      const logs = await getLogs(rpc, {
        address: bridge,
        topics: [null, null, null, receiverTopic], // ERC20Deposited: topic3 = receiver (indexed)
        fromBlock: '0x' + from.toString(16),
        toBlock: '0x' + to.toString(16),
      });
      allLogs.push(...logs);
    } catch {
      // skip failed chunks
    }
  }

  // Decode and build BridgeTx objects
  const txs: BridgeTx[] = [];
  // Batch timestamps: collect unique block numbers
  const blockNumbers = new Set<string>();
  for (const log of allLogs) {
    blockNumbers.add(log.blockNumber);
  }
  // Fetch timestamps in parallel (max 20 at a time)
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

  for (const log of allLogs) {
    try {
      const decoded = decodeEventLog({
        abi: BRIDGE_ERC20_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === 'ERC20Deposited') {
        const args = decoded.args as any;
        const tokenAddr = args.token as string;
        const amount = args.amount as bigint;
        const depositNumber = args.depositNumber as bigint;
        const sourceChainId = Number(args.sourceChainId);
        const targetChainId = Number(args.targetChainId);
        const decimals = resolveTokenDecimals(tokenAddr, chainId);

        txs.push({
          depositTxHash: log.transactionHash,
          sourceChainId,
          targetChainId,
          token: tokenAddr,
          tokenSymbol: resolveTokenSymbol(tokenAddr, chainId),
          amount: formatUnits(amount, decimals),
          depositNumber,
          timestamp: timestampMap.get(log.blockNumber),
          released: false, // will be checked below
        });
      }
    } catch {
      // skip non-matching logs
    }
  }

  return txs;
}

export function useBridgeHistory() {
  const { address } = useAccount();
  const [txs, setTxs] = useState<BridgeTx[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const fetchHistory = useCallback(async () => {
    if (!address) {
      setTxs([]);
      return;
    }

    setLoading(true);
    setError(undefined);

    try {
      // Fetch deposits from both chains in parallel
      const [bscDeposits, bdagDeposits] = await Promise.all([
        fetchDepositsFromChain(BSC_RPC, BSC_CHAIN_ID, address, BSC_BLOCK_RANGE),
        fetchDepositsFromChain(BDAG_RPC, BDAG_CHAIN_ID, address, BSC_BLOCK_RANGE),
      ]);

      const allDeposits = [...bscDeposits, ...bdagDeposits];

      // Check release status for all deposits in parallel (batched)
      const batchSize = 10;
      for (let i = 0; i < allDeposits.length; i += batchSize) {
        const batch = allDeposits.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(tx => checkReleased(tx.sourceChainId, tx.depositNumber).catch(() => false))
        );
        batch.forEach((tx, idx) => { tx.released = results[idx]; });
      }

      // For released deposits, try to find release tx hash (best-effort, parallel)
      const releasedDeposits = allDeposits.filter(tx => tx.released);
      if (releasedDeposits.length > 0) {
        const releaseBatch = 5;
        for (let i = 0; i < releasedDeposits.length; i += releaseBatch) {
          const batch = releasedDeposits.slice(i, i + releaseBatch);
          const hashes = await Promise.all(
            batch.map(tx => findReleaseTxHash(tx.sourceChainId, tx.depositNumber, address).catch(() => undefined))
          );
          batch.forEach((tx, idx) => { tx.releaseTxHash = hashes[idx]; });
        }
      }

      // Sort by timestamp descending (newest first)
      allDeposits.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
      setTxs(allDeposits);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch history');
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return { txs, loading, error, refetch: fetchHistory };
}

// Standalone function: look up a deposit by tx hash
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
  // Try BSC first, then BDAG
  for (const [rpc, chainId] of [[BSC_RPC, BSC_CHAIN_ID], [BDAG_RPC, BDAG_CHAIN_ID]] as const) {
    try {
      const receipt = await getTransactionReceipt(rpc, txHash);
      if (!receipt || !receipt.logs) continue;

      const bridge = CONTRACTS[chainId]?.bridgeERC20;
      if (!bridge) continue;

      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== bridge.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({
            abi: BRIDGE_ERC20_ABI,
            data: log.data,
            topics: log.topics,
          });
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
        } catch {
          // skip
        }
      }
    } catch {
      // try next chain
    }
  }
  return null;
}
