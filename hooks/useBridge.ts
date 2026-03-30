'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useAccount, useWriteContract, useSwitchChain } from 'wagmi';
import { parseUnits, maxUint256, decodeEventLog } from 'viem';
import { BRIDGE_DEPOSIT_ABI, PROSPERITY_BRIDGE_ABI, ERC20_ABI } from '@/lib/abi';
import { CONTRACTS } from '@/config/contracts';
import { Token, getDecimals } from '@/config/tokens';
import { getRpc, rpcCall, getRequiredConfirmations, rotateRpc, isPlaceholderAddress } from '@/config/chainUtils';
import bridgeConfig from '@/config/bridge-config.json';

export type BridgeStatus = 'idle' | 'switching' | 'approving' | 'depositing' | 'confirming' | 'waiting_delivery' | 'delivered' | 'error';

const STORAGE_KEY = 'prosperity_bridge_state';
const STORAGE_VERSION_KEY = 'prosperity_bridge_version';
const HISTORY_KEY = 'prosperity_bridge_history';
const CURRENT_VERSION = '2'; // Bump to clear stale Hyperlane-era state

// Auto-clear stale localStorage on version mismatch
try {
  if (typeof window !== 'undefined') {
    const v = localStorage.getItem(STORAGE_VERSION_KEY);
    if (v !== CURRENT_VERSION) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(HISTORY_KEY);
      localStorage.setItem(STORAGE_VERSION_KEY, CURRENT_VERSION);
    }
  }
} catch {}

function chainGasOverrides(chainId: number) {
  const chain = bridgeConfig.chains[String(chainId) as keyof typeof bridgeConfig.chains];
  if (chain && 'gasPrice' in chain && chain.gasPrice) {
    return { gasPrice: BigInt(chain.gasPrice) };
  }
  return {};
}

interface PersistedBridgeState {
  status: BridgeStatus;
  txHash?: string;
  messageId?: string;
  sourceChainId?: number;
  destChainId?: number;
  timestamp: number;
}

interface BridgeHistoryEntry {
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

function saveState(state: PersistedBridgeState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

function loadState(): PersistedBridgeState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedBridgeState;
    if (Date.now() - parsed.timestamp > 24 * 60 * 60 * 1000) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch { return null; }
}

function clearState() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

/** Save a completed bridge tx to localStorage history. */
function addToHistory(entry: BridgeHistoryEntry) {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const history: BridgeHistoryEntry[] = raw ? JSON.parse(raw) : [];
    // Avoid duplicates
    if (history.some(h => h.txHash === entry.txHash)) return;
    history.unshift(entry);
    // Keep last 100
    if (history.length > 100) history.length = 100;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {}
}

/** Extract depositNumber from ERC20Deposited or NativeDeposited event in tx receipt. */
function extractDepositNumber(logs: any[], bridgeAddress: string): bigint | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== bridgeAddress.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: PROSPERITY_BRIDGE_ABI, data: log.data, topics: log.topics });
      if (decoded.eventName === 'ERC20Deposited' || decoded.eventName === 'NativeDeposited') {
        return (decoded.args as any).depositNumber as bigint;
      }
    } catch { /* skip non-matching */ }
  }
  return null;
}

// Poll for tx receipt via direct RPC
async function waitForReceipt(chainId: number, hash: string, maxAttempts = 90): Promise<any> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const rpc = getRpc(chainId);
      const receipt = await rpcCall(rpc, 'eth_getTransactionReceipt', [hash]);
      if (receipt && receipt.blockNumber) {
        return {
          status: receipt.status === '0x1' ? 'success' : 'reverted',
          blockNumber: BigInt(receipt.blockNumber),
          logs: receipt.logs || [],
        };
      }
    } catch {
      rotateRpc(chainId);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('Transaction confirmation timeout');
}

export function useBridge() {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [status, setStatus] = useState<BridgeStatus>('idle');
  const [txHash, setTxHash] = useState<string>();
  const [messageId, setMessageId] = useState<string>();
  const [error, setError] = useState<string>();
  const [confirmations, setConfirmations] = useState<number>(0);
  const [depositBlock, setDepositBlock] = useState<number>();
  const [activeSourceChainId, setActiveSourceChainId] = useState<number>();
  const [activeDestChainId, setActiveDestChainId] = useState<number>();
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const confirmPollRef = useRef<ReturnType<typeof setInterval>>();
  const restoredRef = useRef(false);

  const requiredConfirmations = activeSourceChainId
    ? getRequiredConfirmations(activeSourceChainId)
    : 15;

  // Cleanup polling intervals on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (confirmPollRef.current) clearInterval(confirmPollRef.current);
    };
  }, []);

  const startConfirmationPolling = useCallback((sourceChainId: number, depBlock: number) => {
    if (confirmPollRef.current) clearInterval(confirmPollRef.current);
    setConfirmations(0);
    const required = getRequiredConfirmations(sourceChainId);

    confirmPollRef.current = setInterval(async () => {
      try {
        const rpc = getRpc(sourceChainId);
        const hex = await rpcCall(rpc, 'eth_blockNumber', []);
        const currentBlock = parseInt(hex, 16);
        const confs = Math.max(0, currentBlock - depBlock);
        setConfirmations(confs);
        if (confs >= required) {
          clearInterval(confirmPollRef.current!);
        }
      } catch {
        rotateRpc(sourceChainId);
      }
    }, 3000);
  }, []);

  /** Poll releasedDeposits(sourceChainId, depositNumber) on destination bridge. */
  const pollForDelivery = useCallback((destChainId: number, srcChainId: number, depositNum: string) => {
    if (pollRef.current) clearInterval(pollRef.current);

    const destBridge = CONTRACTS[destChainId]?.bridge;
    if (!destBridge || isPlaceholderAddress(destBridge)) return;

    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      if (attempts > 720) {
        clearInterval(pollRef.current!);
        setError('Delivery polling timed out after 60 minutes. Your deposit is safe — the relayer will process it.');
        setStatus('error');
        return;
      }
      try {
        const destRpc = getRpc(destChainId);
        // releasedDeposits(uint256,uint256) selector = 0x047a7fe5
        const data = '0x047a7fe5' +
          BigInt(srcChainId).toString(16).padStart(64, '0') +
          BigInt(depositNum).toString(16).padStart(64, '0');
        const result = await rpcCall(destRpc, 'eth_call', [{ to: destBridge, data }, 'latest']);
        const delivered = !!(result && result !== '0x' + '0'.repeat(64));

        if (delivered) {
          clearInterval(pollRef.current!);
          setStatus('delivered');
          clearState();
        }
      } catch {
        rotateRpc(destChainId);
      }
    }, 15000);
  }, []);

  // Restore state from localStorage on mount
  useEffect(() => {
    if (!address) return;
    if (restoredRef.current) return;
    restoredRef.current = true;

    const saved = loadState();
    if (!saved) return;

    if (saved.status === 'waiting_delivery' || saved.status === 'confirming') {
      setStatus(saved.status);
      if (saved.txHash) setTxHash(saved.txHash);
      if (saved.messageId) setMessageId(saved.messageId);
      if (saved.sourceChainId) setActiveSourceChainId(saved.sourceChainId);
      if (saved.destChainId) setActiveDestChainId(saved.destChainId);

      if (saved.messageId && saved.destChainId && saved.sourceChainId) {
        pollForDelivery(saved.destChainId, saved.sourceChainId, saved.messageId);
      }
    } else if (saved.status === 'delivered') {
      setStatus('delivered');
      if (saved.txHash) setTxHash(saved.txHash);
      if (saved.messageId) setMessageId(saved.messageId);
    }
  }, [address, pollForDelivery]);

  const persistState = useCallback((
    newStatus: BridgeStatus,
    newTxHash?: string,
    newMessageId?: string,
    sourceChainId?: number,
    destChainId?: number,
  ) => {
    if (newStatus === 'idle' || newStatus === 'error') return;
    saveState({
      status: newStatus,
      txHash: newTxHash,
      messageId: newMessageId,
      sourceChainId,
      destChainId,
      timestamp: Date.now(),
    });
  }, []);

  const handleDepositReceipt = useCallback(async (
    receipt: any,
    hash: string,
    sourceChainId: number,
    destChainId: number,
    contracts: { bridge: string },
    token: Token,
    amount: string,
    receiver: string,
  ) => {
    if (receipt.status !== 'success') {
      setError('Transaction reverted');
      setStatus('error');
      return;
    }

    const blockNum = Number(receipt.blockNumber);
    setDepositBlock(blockNum);
    startConfirmationPolling(sourceChainId, blockNum);

    const depositNum = extractDepositNumber(receipt.logs, contracts.bridge);
    const depositId = depositNum !== null ? depositNum.toString() : undefined;
    if (depositId) {
      setMessageId(depositId); // reuse messageId state for depositNumber
      setStatus('waiting_delivery');
      persistState('waiting_delivery', hash, depositId, sourceChainId, destChainId);
      pollForDelivery(destChainId, sourceChainId, depositId);

      // Save to history
      addToHistory({
        txHash: hash,
        messageId: depositId,
        sourceChainId,
        destChainId,
        token: token.addresses[sourceChainId] || '',
        tokenSymbol: token.symbol,
        amount,
        receiver,
        timestamp: Date.now(),
        delivered: false,
      });
    } else {
      setStatus('waiting_delivery');
      persistState('waiting_delivery', hash, undefined, sourceChainId, destChainId);
      setError('Could not extract deposit number from receipt. The relayer will still process your deposit.');
    }
  }, [startConfirmationPolling, persistState, pollForDelivery]);

  const bridge = useCallback(async (
    sourceChainId: number,
    token: Token,
    amount: string,
    destChainId: number,
    receiver?: string,
  ) => {
    if (!address) return;
    setError(undefined);
    const to = (receiver || address) as `0x${string}`;
    setActiveSourceChainId(sourceChainId);
    setActiveDestChainId(destChainId);
    const contracts = CONTRACTS[sourceChainId];
    if (!contracts) {
      setError('Chain not supported');
      setStatus('error');
      return;
    }
    if (isPlaceholderAddress(contracts.router)) {
      setError('Bridge not deployed on this chain yet');
      setStatus('error');
      return;
    }

    try {
      if (chainId !== sourceChainId) {
        setStatus('switching');
        await switchChainAsync({ chainId: sourceChainId });
      }

      const amountParsed = parseUnits(amount, getDecimals(token, sourceChainId));
      const bridgeAddr = contracts.bridge;

      if (token.isNative) {
        setStatus('depositing');
        const hash = await writeContractAsync({
          address: bridgeAddr,
          abi: BRIDGE_DEPOSIT_ABI,
          functionName: 'depositNative',
          args: [to, BigInt(destChainId)],
          value: amountParsed,
          ...chainGasOverrides(sourceChainId),
        });
        setTxHash(hash);
        setStatus('confirming');
        persistState('confirming', hash, undefined, sourceChainId, destChainId);

        const receipt = await waitForReceipt(sourceChainId, hash);
        await handleDepositReceipt(receipt, hash, sourceChainId, destChainId, contracts, token, amount, to);
      } else {
        const tokenAddr = token.addresses[sourceChainId] as `0x${string}`;

        // Check existing allowance against bridge contract
        let needsApproval = true;
        try {
          const rpc = getRpc(sourceChainId);
          const ownerPadded = address.slice(2).toLowerCase().padStart(64, '0');
          const spenderPadded = bridgeAddr.slice(2).toLowerCase().padStart(64, '0');
          const data = '0xdd62ed3e' + ownerPadded + spenderPadded;
          const result = await rpcCall(rpc, 'eth_call', [{ to: tokenAddr, data }, 'latest']);
          if (result && result !== '0x') {
            const allowance = BigInt(result);
            needsApproval = allowance < amountParsed;
          }
        } catch {
          rotateRpc(sourceChainId);
        }

        if (needsApproval) {
          setStatus('approving');
          const approveHash = await writeContractAsync({
            address: tokenAddr,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [bridgeAddr, maxUint256],
            ...chainGasOverrides(sourceChainId),
          });
          const approveReceipt = await waitForReceipt(sourceChainId, approveHash);
          if (approveReceipt.status !== 'success') {
            setError('Approval transaction failed');
            setStatus('error');
            return;
          }
        }

        setStatus('depositing');
        const hash = await writeContractAsync({
          address: bridgeAddr,
          abi: BRIDGE_DEPOSIT_ABI,
          functionName: 'depositERC20',
          args: [tokenAddr, amountParsed, to, BigInt(destChainId)],
          ...chainGasOverrides(sourceChainId),
        });
        setTxHash(hash);
        setStatus('confirming');
        persistState('confirming', hash, undefined, sourceChainId, destChainId);

        const receipt = await waitForReceipt(sourceChainId, hash);
        await handleDepositReceipt(receipt, hash, sourceChainId, destChainId, contracts, token, amount, to);
      }
    } catch (err: any) {
      const msg = err.shortMessage || err.message;
      if (msg?.includes('User rejected') || msg?.includes('denied')) {
        setError('Transaction cancelled');
      } else {
        setError(msg);
      }
      setStatus('error');
    }
  }, [address, chainId, switchChainAsync, writeContractAsync, persistState, startConfirmationPolling, handleDepositReceipt, pollForDelivery]);

  const reset = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (confirmPollRef.current) clearInterval(confirmPollRef.current);
    clearState();
    setStatus('idle');
    setTxHash(undefined);
    setMessageId(undefined);
    setDepositBlock(undefined);
    setError(undefined);
    setConfirmations(0);
    setActiveSourceChainId(undefined);
    setActiveDestChainId(undefined);
  }, []);

  return {
    bridge,
    status,
    txHash,
    messageId,
    depositBlock,
    error,
    reset,
    confirmations,
    requiredConfirmations,
    sourceChainId: activeSourceChainId,
    destChainId: activeDestChainId,
  };
}
