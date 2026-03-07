'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useAccount, useWriteContract, usePublicClient, useSwitchChain } from 'wagmi';
import { parseUnits, maxUint256, decodeEventLog, pad } from 'viem';
import { ROUTER_ABI, BRIDGE_ERC20_ABI, ERC20_ABI } from '@/lib/abi';
import { CONTRACTS } from '@/config/contracts';
import { Token, getDecimals } from '@/config/tokens';
import { getRpc, getDestChainId, rpcCall, getRequiredConfirmations, RELAYER_API, rotateRpc } from '@/config/chainUtils';

export type BridgeStatus = 'idle' | 'switching' | 'approving' | 'depositing' | 'confirming' | 'waiting_relayer' | 'released' | 'error';

const STORAGE_KEY = 'bdag_bridge_state';
const BDAG_CHAIN_ID = 1404;
const BDAG_GAS_PRICE = 50000000n;

function bdagGasOverrides(chainId: number) {
  return chainId === BDAG_CHAIN_ID ? { gasPrice: BDAG_GAS_PRICE } : {};
}

interface PersistedBridgeState {
  status: BridgeStatus;
  txHash?: string;
  depositNumber?: string;
  sourceChainId?: number;
  timestamp: number;
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

// Extract depositNumber from a bridge tx receipt
function extractDepositNumber(logs: any[], bridgeAddress: string): bigint | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== bridgeAddress.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: BRIDGE_ERC20_ABI, data: log.data, topics: log.topics });
      if (decoded.eventName === 'ERC20Deposited') {
        return (decoded.args as any).depositNumber as bigint;
      }
    } catch { /* skip non-matching */ }
  }
  return null;
}

export function useBridge() {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const [status, setStatus] = useState<BridgeStatus>('idle');
  const [txHash, setTxHash] = useState<string>();
  const [releaseTxHash, setReleaseTxHash] = useState<string>();
  const [depositNumber, setDepositNumber] = useState<bigint>();
  const [error, setError] = useState<string>();
  const [confirmations, setConfirmations] = useState<number>(0);
  const [activeSourceChainId, setActiveSourceChainId] = useState<number>();
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
    const rpc = getRpc(sourceChainId);
    const required = getRequiredConfirmations(sourceChainId);

    confirmPollRef.current = setInterval(async () => {
      try {
        const hex = await rpcCall(rpc, 'eth_blockNumber', []);
        const currentBlock = parseInt(hex, 16);
        const confs = Math.max(0, currentBlock - depBlock);
        setConfirmations(confs);
        if (confs >= required) {
          clearInterval(confirmPollRef.current!);
        }
      } catch { /* ignore */ }
    }, 3000);
  }, []);

  const findReleaseTx = useCallback(async (sourceChainId: number, depNum: bigint, receiverAddr: string) => {
    const destChainId = getDestChainId(sourceChainId);
    const destRpc = getRpc(destChainId);
    const bridge = CONTRACTS[destChainId]?.bridgeERC20;
    if (!bridge) return;

    try {
      const receiverTopic = pad(receiverAddr as `0x${string}`, { size: 32 });
      const hex = await rpcCall(destRpc, 'eth_blockNumber', []);
      const latestBlock = parseInt(hex, 16);
      const fromBlock = Math.max(0, latestBlock - 10000);

      const logs = await rpcCall(destRpc, 'eth_getLogs', [{
        address: bridge,
        topics: [null, null, null, receiverTopic],
        fromBlock: '0x' + fromBlock.toString(16),
        toBlock: '0x' + latestBlock.toString(16),
      }]);

      for (const log of logs || []) {
        try {
          const decoded = decodeEventLog({ abi: BRIDGE_ERC20_ABI, data: log.data, topics: log.topics });
          if (decoded.eventName === 'ERC20Released') {
            const args = decoded.args as any;
            if (BigInt(args.depositNumber) === depNum && BigInt(args.depositChainId) === BigInt(sourceChainId)) {
              setReleaseTxHash(log.transactionHash);
              return;
            }
          }
        } catch { /* skip */ }
      }
    } catch { /* ignore */ }
  }, []);

  const pollForRelease = useCallback((sourceChainId: number, depNum: bigint) => {
    if (pollRef.current) clearInterval(pollRef.current);

    const destChainId = getDestChainId(sourceChainId);
    const destRpc = getRpc(destChainId);
    const destBridge = CONTRACTS[destChainId]?.bridgeERC20;
    if (!destBridge) return;

    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      if (attempts > 720) {
        clearInterval(pollRef.current!);
        return;
      }
      try {
        // Try relayer API first (fastest, has the tx hash)
        let released = false;
        try {
          const apiRes = await fetch(`${RELAYER_API}/deposit/${sourceChainId}/${depNum}`);
          if (apiRes.ok) {
            const apiData = await apiRes.json();
            if (apiData.processed) {
              released = true;
              const rh = apiData.releaseTxHash || '';
              if (rh && !rh.startsWith('already') && rh !== 'sent' && !rh.startsWith('unconfirmed:') && !rh.startsWith('reverted:')) {
                setReleaseTxHash(rh);
              }
            }
          }
        } catch { /* relayer API unavailable, fallback to RPC */ }

        // Fallback: check on-chain directly
        if (!released) {
          const data = '0x047a7fe5' +
            sourceChainId.toString(16).padStart(64, '0') +
            depNum.toString(16).padStart(64, '0');
          const result = await rpcCall(destRpc, 'eth_call', [{ to: destBridge, data }, 'latest']);
          released = !!(result && result !== '0x' + '0'.repeat(64));
        }

        if (released) {
          clearInterval(pollRef.current!);
          // If we don't have releaseTxHash yet, try to find it from logs
          if (!releaseTxHash && address) {
            await findReleaseTx(sourceChainId, depNum, address);
          }
          setStatus('released');
          clearState();
        }
      } catch { /* ignore */ }
    }, 5000);
  }, [address, findReleaseTx, releaseTxHash]);

  // Recover depositNumber from tx receipt when not persisted
  const recoverDepositNumber = useCallback(async (hash: string, sourceChainId: number): Promise<bigint | null> => {
    const rpc = getRpc(sourceChainId);
    const bridge = CONTRACTS[sourceChainId]?.bridgeERC20;
    if (!bridge) return null;
    try {
      const receipt = await rpcCall(rpc, 'eth_getTransactionReceipt', [hash]);
      if (!receipt?.logs) return null;
      return extractDepositNumber(receipt.logs, bridge);
    } catch { return null; }
  }, []);

  // Restore state from localStorage on mount
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    const saved = loadState();
    if (!saved) return;

    if (saved.status === 'waiting_relayer' || saved.status === 'confirming') {
      setStatus(saved.status);
      if (saved.txHash) setTxHash(saved.txHash);
      if (saved.sourceChainId) setActiveSourceChainId(saved.sourceChainId);

      const startPolling = (depNum: bigint) => {
        setDepositNumber(depNum);
        if (saved.sourceChainId) {
          saveState({ ...saved, depositNumber: depNum.toString(), timestamp: Date.now() });
          pollForRelease(saved.sourceChainId, depNum);
        }
      };

      if (saved.depositNumber) {
        startPolling(BigInt(saved.depositNumber));
      } else if (saved.txHash && saved.sourceChainId) {
        recoverDepositNumber(saved.txHash, saved.sourceChainId).then(depNum => {
          if (depNum !== null) startPolling(depNum);
        });
      }
    } else if (saved.status === 'released') {
      setStatus('released');
      if (saved.txHash) setTxHash(saved.txHash);
      if (saved.depositNumber) setDepositNumber(BigInt(saved.depositNumber));
    }
  }, [pollForRelease, recoverDepositNumber]);

  const persistState = useCallback((
    newStatus: BridgeStatus,
    newTxHash?: string,
    newDepositNumber?: bigint,
    sourceChainId?: number,
  ) => {
    if (newStatus === 'idle' || newStatus === 'error') return;
    saveState({
      status: newStatus,
      txHash: newTxHash,
      depositNumber: newDepositNumber?.toString(),
      sourceChainId,
      timestamp: Date.now(),
    });
  }, []);

  // Common logic after deposit receipt is confirmed
  const handleDepositReceipt = useCallback(async (
    receipt: any,
    hash: string,
    sourceChainId: number,
    contracts: { bridgeERC20: string },
  ) => {
    if (receipt.status !== 'success') {
      setError('Transaction reverted');
      setStatus('error');
      return;
    }

    const blockNum = Number(receipt.blockNumber);
    startConfirmationPolling(sourceChainId, blockNum);

    const depNum = extractDepositNumber(receipt.logs, contracts.bridgeERC20);
    if (depNum !== null) {
      setDepositNumber(depNum);
      setStatus('waiting_relayer');
      persistState('waiting_relayer', hash, depNum, sourceChainId);
      pollForRelease(sourceChainId, depNum);
    } else {
      // Couldn't extract depositNumber — still transition to waiting
      setStatus('waiting_relayer');
      persistState('waiting_relayer', hash, undefined, sourceChainId);
    }
  }, [startConfirmationPolling, persistState, pollForRelease]);

  const bridge = useCallback(async (
    sourceChainId: number,
    token: Token,
    amount: string,
    receiver?: string,
  ) => {
    if (!address) return;
    const to = (receiver || address) as `0x${string}`;
    const targetChainId = getDestChainId(sourceChainId);
    setActiveSourceChainId(sourceChainId);
    const contracts = CONTRACTS[sourceChainId];
    if (!contracts) {
      setError('Chain not supported');
      setStatus('error');
      return;
    }

    try {
      if (chainId !== sourceChainId) {
        setStatus('switching');
        await switchChainAsync({ chainId: sourceChainId });
      }

      const amountParsed = parseUnits(amount, getDecimals(token, sourceChainId));

      if (token.isNative) {
        setStatus('depositing');
        const hash = await writeContractAsync({
          address: contracts.router,
          abi: ROUTER_ABI,
          functionName: 'depositNativeTokensToBridge',
          args: [amountParsed, to, BigInt(targetChainId)],
          value: amountParsed,
          ...bdagGasOverrides(sourceChainId),
        });
        setTxHash(hash);
        setStatus('confirming');
        persistState('confirming', hash, undefined, sourceChainId);

        if (publicClient) {
          const receipt = await publicClient.waitForTransactionReceipt({ hash });
          await handleDepositReceipt(receipt, hash, sourceChainId, contracts);
        }
      } else {
        const tokenAddr = token.addresses[sourceChainId] as `0x${string}`;

        // Check existing allowance via direct RPC (publicClient may be stale after chain switch)
        let needsApproval = true;
        try {
          const rpc = getRpc(sourceChainId);
          // allowance(address,address) selector = 0xdd62ed3e
          const ownerPadded = address.slice(2).toLowerCase().padStart(64, '0');
          const spenderPadded = contracts.router.slice(2).toLowerCase().padStart(64, '0');
          const data = '0xdd62ed3e' + ownerPadded + spenderPadded;
          const result = await rpcCall(rpc, 'eth_call', [{ to: tokenAddr, data }, 'latest']);
          if (result && result !== '0x') {
            const allowance = BigInt(result);
            needsApproval = allowance < amountParsed;
          }
        } catch {
          // If RPC fails, rotate and default to requesting approval
          rotateRpc(sourceChainId);
        }

        if (needsApproval) {
          setStatus('approving');
          const approveHash = await writeContractAsync({
            address: tokenAddr,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [contracts.router, maxUint256],
            ...bdagGasOverrides(sourceChainId),
          });
          if (publicClient) {
            const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
            if (approveReceipt.status !== 'success') {
              setError('Approval transaction failed');
              setStatus('error');
              return;
            }
          }
        }

        setStatus('depositing');
        const hash = await writeContractAsync({
          address: contracts.router,
          abi: ROUTER_ABI,
          functionName: 'depositERC20TokensToBridge',
          args: [tokenAddr, amountParsed, to, BigInt(targetChainId)],
          ...bdagGasOverrides(sourceChainId),
        });
        setTxHash(hash);
        setStatus('confirming');
        persistState('confirming', hash, undefined, sourceChainId);

        if (publicClient) {
          const receipt = await publicClient.waitForTransactionReceipt({ hash });
          await handleDepositReceipt(receipt, hash, sourceChainId, contracts);
        }
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
  }, [address, chainId, switchChainAsync, writeContractAsync, publicClient, pollForRelease, persistState, startConfirmationPolling, handleDepositReceipt]);

  const reset = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (confirmPollRef.current) clearInterval(confirmPollRef.current);
    clearState();
    setStatus('idle');
    setTxHash(undefined);
    setReleaseTxHash(undefined);
    setDepositNumber(undefined);
    setError(undefined);
    setConfirmations(0);
    setActiveSourceChainId(undefined);
  }, []);

  return { bridge, status, txHash, releaseTxHash, depositNumber, error, reset, confirmations, requiredConfirmations, sourceChainId: activeSourceChainId };
}
