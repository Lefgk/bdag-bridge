'use client';

import { useState, useCallback } from 'react';
import { useAccount, useWriteContract, useReadContract, useSwitchChain } from 'wagmi';
import { parseUnits, maxUint256 } from 'viem';
import { ROUTER_ABI, ERC20_ABI } from '@/lib/abi';
import { CONTRACTS } from '@/config/contracts';
import { Token } from '@/config/tokens';

export function useLiquidity() {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const addLiquidity = useCallback(async (
    sourceChainId: number,
    token: Token,
    amount: string,
  ) => {
    if (!address) return;
    const contracts = CONTRACTS[sourceChainId];
    if (!contracts) return;

    try {
      setLoading(true);
      setError(undefined);

      if (chainId !== sourceChainId) {
        await switchChainAsync({ chainId: sourceChainId });
      }

      const amountParsed = parseUnits(amount, token.decimals);

      if (token.isNative) {
        await writeContractAsync({
          address: contracts.router,
          abi: ROUTER_ABI,
          functionName: 'addLiquidityNative',
          args: [amountParsed],
          value: amountParsed,
        });
      } else {
        const tokenAddr = token.addresses[sourceChainId] as `0x${string}`;
        // Approve
        await writeContractAsync({
          address: tokenAddr,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [contracts.router, maxUint256],
        });
        // Add liquidity
        await writeContractAsync({
          address: contracts.router,
          abi: ROUTER_ABI,
          functionName: 'addLiquidityERC20',
          args: [tokenAddr, amountParsed],
        });
      }
    } catch (err: any) {
      setError(err.shortMessage || err.message);
    } finally {
      setLoading(false);
    }
  }, [address, chainId, switchChainAsync, writeContractAsync]);

  const removeLiquidity = useCallback(async (
    sourceChainId: number,
    token: Token,
    lpAmount: string,
  ) => {
    if (!address) return;
    const contracts = CONTRACTS[sourceChainId];
    if (!contracts) return;

    try {
      setLoading(true);
      setError(undefined);

      if (chainId !== sourceChainId) {
        await switchChainAsync({ chainId: sourceChainId });
      }

      const tokenAddr = token.addresses[sourceChainId] as `0x${string}`;
      const lpAmountParsed = parseUnits(lpAmount, 18); // LP tokens always 18 decimals

      await writeContractAsync({
        address: contracts.router,
        abi: ROUTER_ABI,
        functionName: 'withdrawLiquidityERC20',
        args: [tokenAddr, lpAmountParsed],
      });
    } catch (err: any) {
      setError(err.shortMessage || err.message);
    } finally {
      setLoading(false);
    }
  }, [address, chainId, switchChainAsync, writeContractAsync]);

  return { addLiquidity, removeLiquidity, loading, error };
}
