'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useAccount, useWriteContract, useSwitchChain } from 'wagmi';
import { parseUnits, maxUint256, decodeEventLog, pad } from 'viem';
import { ROUTER_ABI, BRIDGE_ERC20_ABI, ERC20_ABI } from '@/lib/abi';
import { CONTRACTS } from '@/config/contracts';
import { Token, getDecimals } from '@/config/tokens';
import { getRpc, getDestChainId, rpcCall, getRequiredConfirmations, RELAYER_API, rotateRpc, BDAG_CHAIN_ID } from '@/config/chainUtils';
import bridgeConfig from '@/config/bridge-config.json';

export type BridgeStatus = 'idle' | 'switching' | 'approving' | 'depositing' | 'confirming' | 'waiting_relayer' | 'released' | 'error';

const STORAGE_KEY = 'bdag_bridge_state';

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

// Poll for tx receipt via direct RPC (avoids stale publicClient after chain switch)
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
      // Rotate RPC on failure
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
  const [releaseTxHash, setReleaseTxHash] = useState<string>();
  const [depositNumber, setDepositNumber] = useState<bigint>();
  const [error, setError] = useState<string>();
  const [confirmations, setConfirmations] = useState<number>(0);
  const [depositBlock, setDepositBlock] = useState<number>();
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

  const findReleaseTx = useCallback(async (sourceChainId: number, depNum: bigint, receiverAddr: string) => {
    const destChainId = getDestChainId(sourceChainId);
    const bridge = CONTRACTS[destChainId]?.bridgeERC20;
    if (!bridge) return;

    try {
      const destRpc = getRpc(destChainId);
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
    } catch {
      rotateRpc(getDestChainId(sourceChainId));
    }
  }, []);

  // Fallback polling by tx hash when depositNumber can't be extracted
  const pollForReleaseByTxHash = useCallback((hash: string, _sourceChainId: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      if (attempts > 720) {
        clearInterval(pollRef.current!);
        setError('Release polling timed out after 60 minutes. Your deposit is safe — check transaction history or try again later.');
        setStatus('error');
        return;
      }
      try {
        const res = await fetch(`${RELAYER_API}/check-tx/${hash}`, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) return;
        const data = await res.json();
        // API returns: { status: 'already_processed'|'released', releaseTxHash }
        if (data.status === 'already_processed' || data.status === 'released') {
          clearInterval(pollRef.current!);
          if (data.releaseTxHash?.startsWith('0x')) setReleaseTxHash(data.releaseTxHash);
          setStatus('released');
          clearState();
        }
      } catch { /* ignore */ }
    }, 5000);
  }, []);

  const pollForRelease = useCallback((sourceChainId: number, depNum: bigint) => {
    if (pollRef.current) clearInterval(pollRef.current);

    const destChainId = getDestChainId(sourceChainId);
    const destBridge = CONTRACTS[destChainId]?.bridgeERC20;
    if (!destBridge) return;

    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      if (attempts > 720) {
        // 720 * 5s = 60 minutes — surface error instead of silently dying
        clearInterval(pollRef.current!);
        setError('Release polling timed out after 60 minutes. Your deposit is safe — check transaction history or try again later.');
        setStatus('error');
        return;
      }
      try {
        // Try relayer API first (fastest, has the tx hash)
        let released = false;
        try {
          const apiRes = await fetch(`${RELAYER_API}/deposit/${sourceChainId}/${depNum}`, { signal: AbortSignal.timeout(10000) });
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
          const destRpc = getRpc(destChainId);
          const data = '0x047a7fe5' +
            sourceChainId.toString(16).padStart(64, '0') +
            depNum.toString(16).padStart(64, '0');
          try {
            const result = await rpcCall(destRpc, 'eth_call', [{ to: destBridge, data }, 'latest']);
            released = !!(result && result !== '0x' + '0'.repeat(64));
          } catch {
            rotateRpc(destChainId);
          }
        }

        if (released) {
          clearInterval(pollRef.current!);
          // Always try to find release tx from logs (releaseTxHash closure may be stale)
          if (address) {
            await findReleaseTx(sourceChainId, depNum, address);
          }
          setStatus('released');
          clearState();
        }
      } catch { /* ignore */ }
    }, 5000);
  }, [address, findReleaseTx]);

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

  // Restore state from localStorage on mount or when wallet connects
  useEffect(() => {
    if (!address) return; // Don't restore until wallet is connected
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
          if (depNum !== null) {
            startPolling(depNum);
          } else {
            // Can't recover depositNumber — fall back to check-tx polling
            pollForReleaseByTxHash(saved.txHash!, saved.sourceChainId!);
          }
        });
      }
    } else if (saved.status === 'released') {
      setStatus('released');
      if (saved.txHash) setTxHash(saved.txHash);
      if (saved.depositNumber) setDepositNumber(BigInt(saved.depositNumber));
    }
  }, [address, pollForRelease, recoverDepositNumber, pollForReleaseByTxHash]);

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
    setDepositBlock(blockNum);
    startConfirmationPolling(sourceChainId, blockNum);

    const depNum = extractDepositNumber(receipt.logs, contracts.bridgeERC20);
    if (depNum !== null) {
      setDepositNumber(depNum);
      setStatus('waiting_relayer');
      persistState('waiting_relayer', hash, depNum, sourceChainId);
      pollForRelease(sourceChainId, depNum);
    } else {
      // Couldn't extract depositNumber — recover it from RPC receipt and still poll
      setStatus('waiting_relayer');
      persistState('waiting_relayer', hash, undefined, sourceChainId);
      recoverDepositNumber(hash, sourceChainId).then(recovered => {
        if (recovered !== null) {
          setDepositNumber(recovered);
          persistState('waiting_relayer', hash, recovered, sourceChainId);
          pollForRelease(sourceChainId, recovered);
        } else {
          // Last resort: poll using check-tx API endpoint
          pollForReleaseByTxHash(hash, sourceChainId);
        }
      });
    }
  }, [startConfirmationPolling, persistState, pollForRelease, recoverDepositNumber, pollForReleaseByTxHash]);

  const bridge = useCallback(async (
    sourceChainId: number,
    token: Token,
    amount: string,
    receiver?: string,
  ) => {
    if (!address) return;
    setError(undefined);
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
          ...chainGasOverrides(sourceChainId),
        });
        setTxHash(hash);
        setStatus('confirming');
        persistState('confirming', hash, undefined, sourceChainId);

        const receipt = await waitForReceipt(sourceChainId, hash);
        await handleDepositReceipt(receipt, hash, sourceChainId, contracts);
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
          address: contracts.router,
          abi: ROUTER_ABI,
          functionName: 'depositERC20TokensToBridge',
          args: [tokenAddr, amountParsed, to, BigInt(targetChainId)],
          ...chainGasOverrides(sourceChainId),
        });
        setTxHash(hash);
        setStatus('confirming');
        persistState('confirming', hash, undefined, sourceChainId);

        const receipt = await waitForReceipt(sourceChainId, hash);
        await handleDepositReceipt(receipt, hash, sourceChainId, contracts);
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
  }, [address, chainId, switchChainAsync, writeContractAsync, pollForRelease, persistState, startConfirmationPolling, handleDepositReceipt]);

  const reset = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (confirmPollRef.current) clearInterval(confirmPollRef.current);
    clearState();
    setStatus('idle');
    setTxHash(undefined);
    setReleaseTxHash(undefined);
    setDepositNumber(undefined);
    setDepositBlock(undefined);
    setError(undefined);
    setConfirmations(0);
    setActiveSourceChainId(undefined);
  }, []);

  return { bridge, status, txHash, releaseTxHash, depositNumber, depositBlock, error, reset, confirmations, requiredConfirmations, sourceChainId: activeSourceChainId };
}
