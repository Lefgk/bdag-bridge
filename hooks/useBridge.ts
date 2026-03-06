'use client';

import { useState, useCallback, useRef } from 'react';
import { useAccount, useWriteContract, usePublicClient, useSwitchChain } from 'wagmi';
import { parseUnits, maxUint256, decodeEventLog } from 'viem';
import { ROUTER_ABI, BRIDGE_ERC20_ABI, ERC20_ABI } from '@/lib/abi';
import { CONTRACTS } from '@/config/contracts';
import { Token } from '@/config/tokens';
import { blockdag } from '@/config/chains';

export type BridgeStatus = 'idle' | 'switching' | 'approving' | 'depositing' | 'confirming' | 'waiting_relayer' | 'released' | 'error';

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
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  // Poll BlockDAG to check if deposit was released
  const pollForRelease = useCallback((sourceChainId: number, depNum: bigint) => {
    if (pollRef.current) clearInterval(pollRef.current);

    const bdagBridge = CONTRACTS[1404]?.bridgeERC20;
    if (!bdagBridge) return;

    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      if (attempts > 60) { // 5 min timeout
        clearInterval(pollRef.current!);
        return;
      }
      try {
        const body = JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_call',
          params: [{
            to: bdagBridge,
            data: '0x' + 'a06e12e8' + // releasedDeposits(uint256,uint256)
              sourceChainId.toString(16).padStart(64, '0') +
              depNum.toString(16).padStart(64, '0'),
          }, 'latest'],
          id: 1,
        });
        const res = await fetch('https://rpc.bdagscan.com', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        const json = await res.json();
        // releasedDeposits returns bool — 0x...01 means true
        if (json.result && json.result !== '0x' + '0'.repeat(64)) {
          setStatus('released');
          clearInterval(pollRef.current!);
        }
      } catch {
        // ignore poll errors
      }
    }, 5000);
  }, []);

  const bridge = useCallback(async (
    sourceChainId: number,
    token: Token,
    amount: string,
    receiver?: string,
  ) => {
    if (!address) return;
    const to = (receiver || address) as `0x${string}`;
    const contracts = CONTRACTS[sourceChainId];
    if (!contracts) {
      setError('Chain not supported');
      setStatus('error');
      return;
    }

    try {
      // Switch chain if needed
      if (chainId !== sourceChainId) {
        setStatus('switching');
        await switchChainAsync({ chainId: sourceChainId });
      }

      const amountParsed = parseUnits(amount, token.decimals);

      if (token.isNative) {
        setStatus('depositing');
        const hash = await writeContractAsync({
          address: contracts.router,
          abi: ROUTER_ABI,
          functionName: 'depositNativeTokensToBridge',
          args: [amountParsed, to, BigInt(1404)],
          value: amountParsed,
        });
        setTxHash(hash);
        setStatus('confirming');

        // Wait for receipt
        if (publicClient) {
          const receipt = await publicClient.waitForTransactionReceipt({ hash });
          if (receipt.status === 'success') {
            // Try to get deposit number from logs
            try {
              for (const log of receipt.logs) {
                if (log.address.toLowerCase() === contracts.bridgeERC20.toLowerCase()) {
                  const decoded = decodeEventLog({ abi: BRIDGE_ERC20_ABI, data: log.data, topics: log.topics });
                  if (decoded.eventName === 'NativeDeposited' || decoded.eventName === 'ERC20Deposited') {
                    const depNum = (decoded.args as any).depositNumber;
                    setDepositNumber(depNum);
                    setStatus('waiting_relayer');
                    pollForRelease(sourceChainId, depNum);
                    return;
                  }
                }
              }
            } catch {}
            setStatus('waiting_relayer');
          } else {
            setError('Transaction reverted');
            setStatus('error');
          }
        }
      } else {
        // ERC20: check allowance, approve if needed, then deposit
        const tokenAddr = token.addresses[sourceChainId] as `0x${string}`;

        // Check existing allowance
        let needsApproval = true;
        if (publicClient) {
          try {
            const allowance = await publicClient.readContract({
              address: tokenAddr,
              abi: ERC20_ABI,
              functionName: 'allowance',
              args: [address, contracts.router],
            }) as bigint;
            needsApproval = allowance < amountParsed;
          } catch {}
        }

        if (needsApproval) {
          setStatus('approving');
          const approveHash = await writeContractAsync({
            address: tokenAddr,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [contracts.router, maxUint256],
          });
          // Wait for approval to confirm
          if (publicClient) {
            await publicClient.waitForTransactionReceipt({ hash: approveHash });
          }
        }

        setStatus('depositing');
        const hash = await writeContractAsync({
          address: contracts.router,
          abi: ROUTER_ABI,
          functionName: 'depositERC20TokensToBridge',
          args: [tokenAddr, amountParsed, to, BigInt(1404)],
        });
        setTxHash(hash);
        setStatus('confirming');

        // Wait for receipt
        if (publicClient) {
          const receipt = await publicClient.waitForTransactionReceipt({ hash });
          if (receipt.status === 'success') {
            try {
              for (const log of receipt.logs) {
                if (log.address.toLowerCase() === contracts.bridgeERC20.toLowerCase()) {
                  const decoded = decodeEventLog({ abi: BRIDGE_ERC20_ABI, data: log.data, topics: log.topics });
                  if (decoded.eventName === 'ERC20Deposited') {
                    const depNum = (decoded.args as any).depositNumber;
                    setDepositNumber(depNum);
                    setStatus('waiting_relayer');
                    pollForRelease(sourceChainId, depNum);
                    return;
                  }
                }
              }
            } catch {}
            setStatus('waiting_relayer');
          } else {
            setError('Transaction reverted');
            setStatus('error');
          }
        }
      }
    } catch (err: any) {
      // User rejected or other error
      const msg = err.shortMessage || err.message;
      if (msg?.includes('User rejected') || msg?.includes('denied')) {
        setError('Transaction cancelled');
      } else {
        setError(msg);
      }
      setStatus('error');
    }
  }, [address, chainId, switchChainAsync, writeContractAsync, publicClient, pollForRelease]);

  const reset = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    setStatus('idle');
    setTxHash(undefined);
    setReleaseTxHash(undefined);
    setDepositNumber(undefined);
    setError(undefined);
  }, []);

  return { bridge, status, txHash, releaseTxHash, depositNumber, error, reset };
}
