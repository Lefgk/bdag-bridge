'use client';

import { useReadContract } from 'wagmi';
import { PROSPERITY_BRIDGE_ABI } from '@/lib/abi';
import { CONTRACTS } from '@/config/contracts';

/** Polls processedMessages(messageId) on the destination chain bridge contract. */
export function useMessageStatus(destChainId: number, messageId?: string) {
  const destContracts = CONTRACTS[destChainId];

  const { data: isDelivered } = useReadContract({
    address: destContracts?.bridge,
    abi: PROSPERITY_BRIDGE_ABI,
    functionName: 'processedMessages',
    args: messageId ? [messageId as `0x${string}`] : undefined,
    query: {
      enabled: !!messageId && !!destContracts?.bridge,
      refetchInterval: 15000,
    },
  });

  return { isDelivered: !!isDelivered };
}
