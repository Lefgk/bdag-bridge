'use client';

import { SOURCE_CHAINS } from '@/config/chains';
import config from '@/config/bridge-config.json';

interface Props {
  selectedChainId: number;
  onSelect: (chainId: number) => void;
}

function getChainIcon(chainId: number): string | undefined {
  return (config.chains[String(chainId) as keyof typeof config.chains] as any)?.icon;
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
          {getChainIcon(chain.id) ? (
            <img src={getChainIcon(chain.id)} alt="" className="w-4 h-4 rounded-full" />
          ) : (
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: chain.color }}
            />
          )}
          {chain.label}
        </button>
      ))}
    </div>
  );
}
