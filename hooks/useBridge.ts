'use client';

import { useState, useCallback } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract, useSwitchChain } from 'wagmi';
import { parseUnits, maxUint256 } from 'viem';
import { ROUTER_ABI, ERC20_ABI } from '@/lib/abi';
import { CONTRACTS } from '@/config/contracts';
import { Token } from '@/config/tokens';

type BridgeStatus = 'idle' | 'approving' | 'depositing' | 'pending' | 'confirmed' | 'released' | 'error';

export function useBridge() {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [status, setStatus] = useState<BridgeStatus>('idle');
  const [txHash, setTxHash] = useState<string>();
  const [error, setError] = useState<string>();

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
        await switchChainAsync({ chainId: sourceChainId });
      }

      const amountParsed = parseUnits(amount, token.decimals);

      if (token.isNative) {
        // Native deposit
        setStatus('depositing');
        const hash = await writeContractAsync({
          address: contracts.router,
          abi: ROUTER_ABI,
          functionName: 'depositNativeTokensToBridge',
          args: [amountParsed, to, BigInt(1404)],
          value: amountParsed,
        });
        setTxHash(hash);
        setStatus('pending');
      } else {
        // ERC20: approve then deposit
        const tokenAddr = token.addresses[sourceChainId] as `0x${string}`;

        setStatus('approving');
        const approveHash = await writeContractAsync({
          address: tokenAddr,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [contracts.router, maxUint256],
        });
        // Wait for approval (simplified — in production poll receipt)
        setStatus('depositing');
        const hash = await writeContractAsync({
          address: contracts.router,
          abi: ROUTER_ABI,
          functionName: 'depositERC20TokensToBridge',
          args: [tokenAddr, amountParsed, to, BigInt(1404)],
        });
        setTxHash(hash);
        setStatus('pending');
      }

      // After deposit is confirmed, relayer will pick it up
      setStatus('confirmed');
    } catch (err: any) {
      setError(err.shortMessage || err.message);
      setStatus('error');
    }
  }, [address, chainId, switchChainAsync, writeContractAsync]);

  const reset = useCallback(() => {
    setStatus('idle');
    setTxHash(undefined);
    setError(undefined);
  }, []);

  return { bridge, status, txHash, error, reset };
}
