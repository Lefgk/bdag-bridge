'use client';

import { useReadContract } from 'wagmi';
import { BRIDGE_ERC20_ABI } from '@/lib/abi';
import { CONTRACTS } from '@/config/contracts';

export function useDepositStatus(depositChainId: number, depositNumber: bigint) {
  const bdagContracts = CONTRACTS[1404];

  const { data: isReleased } = useReadContract({
    address: bdagContracts?.bridgeERC20,
    abi: BRIDGE_ERC20_ABI,
    functionName: 'releasedDeposits',
    args: [BigInt(depositChainId), depositNumber],
    query: {
      enabled: depositNumber > 0n,
      refetchInterval: 15000, // poll every 15s
    },
  });

  return { isReleased: !!isReleased };
}
