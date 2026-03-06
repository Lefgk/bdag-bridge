'use client';

import { Token } from '@/config/tokens';

interface Props {
  tokens: Token[];
  selected: Token | null;
  onSelect: (token: Token) => void;
}

export function TokenSelector({ tokens, selected, onSelect }: Props) {
  return (
    <div className="relative">
      <select
        value={selected?.symbol || ''}
        onChange={(e) => {
          const token = tokens.find(t => t.symbol === e.target.value);
          if (token) onSelect(token);
        }}
        className="w-full bg-card border border-gray-700 rounded-lg px-4 py-3 text-white appearance-none cursor-pointer focus:border-accent focus:outline-none"
      >
        <option value="" disabled>Select token</option>
        {tokens.map((token) => (
          <option key={token.symbol} value={token.symbol}>
            {token.symbol} - {token.name}
          </option>
        ))}
      </select>
      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
        &#9662;
      </div>
    </div>
  );
}
