'use client';

import { SOURCE_CHAINS } from '@/config/chains';

interface Props {
  selectedChainId: number;
  onSelect: (chainId: number) => void;
}

export function ChainSelector({ selectedChainId, onSelect }: Props) {
  return (
    <div className="flex gap-2">
      {SOURCE_CHAINS.map((chain) => (
        <button
          key={chain.id}
          onClick={() => onSelect(chain.id)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-all ${
            selectedChainId === chain.id
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-gray-700 bg-card text-gray-400 hover:border-gray-500'
          }`}
        >
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: chain.color }}
          />
          {chain.label}
        </button>
      ))}
    </div>
  );
}
