'use client';

import { useState, useRef, useEffect } from 'react';
import { useAccount, useBalance } from 'wagmi';
import { formatUnits } from 'viem';
import { Token } from '@/config/tokens';

interface Props {
  tokens: Token[];
  selected: Token | null;
  onSelect: (token: Token) => void;
  sourceChainId: number;
  disabled?: boolean;
}

function TokenBalance({ token, chainId }: { token: Token; chainId: number }) {
  const { address, isConnected } = useAccount();
  const tokenAddr = !token.isNative ? token.addresses[chainId] : undefined;
  const { data: balance } = useBalance({
    address,
    token: tokenAddr as `0x${string}` | undefined,
    chainId,
    query: { enabled: isConnected },
  });

  if (!isConnected || !balance) return null;

  const formatted = parseFloat(formatUnits(balance.value, balance.decimals));
  return (
    <span className="text-xs text-gray-400 font-mono">
      {formatted > 0 ? formatted.toFixed(4) : '0'}
    </span>
  );
}

export function TokenSelector({ tokens, selected, onSelect, sourceChainId, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const truncAddr = (addr: string) =>
    `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  return (
    <div ref={ref} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="w-full bg-card border border-gray-700 rounded-lg px-4 py-3 text-left flex items-center gap-3 cursor-pointer hover:border-gray-500 focus:border-accent focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {selected ? (
          <>
            <img
              src={selected.icon}
              alt={selected.symbol}
              className="w-6 h-6 rounded-full"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            <div className="flex-1 min-w-0">
              <span className="text-white font-semibold">{selected.symbol}</span>
              <span className="text-gray-400 text-sm ml-2">{selected.name}</span>
            </div>
            <TokenBalance token={selected} chainId={sourceChainId} />
          </>
        ) : (
          <span className="text-gray-500">Select token</span>
        )}
        <span className="text-gray-400 ml-auto shrink-0">&#9662;</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 w-full mt-2 bg-card border border-gray-700 rounded-xl shadow-2xl max-h-[300px] overflow-y-auto">
          {tokens.map((token) => {
            const addr = token.addresses[sourceChainId];
            const isSelected = selected?.symbol === token.symbol && selected?.name === token.name;
            return (
              <button
                key={`${token.symbol}-${token.name}`}
                type="button"
                onClick={() => {
                  onSelect(token);
                  setOpen(false);
                }}
                className={`w-full px-4 py-3 flex items-center gap-3 hover:bg-white/5 transition-colors text-left ${
                  isSelected ? 'bg-accent/10 border-l-2 border-accent' : ''
                }`}
              >
                <img
                  src={token.icon}
                  alt={token.symbol}
                  className="w-8 h-8 rounded-full shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-semibold text-sm">{token.symbol}</span>
                    <span className="text-gray-500 text-xs">{token.name}</span>
                  </div>
                  {addr && (
                    <div className="text-[10px] text-gray-600 font-mono mt-0.5 truncate">
                      {addr}
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <TokenBalance token={token} chainId={sourceChainId} />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
