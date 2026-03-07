'use client';

import { useState, useMemo } from 'react';
import { useAccount, useBalance } from 'wagmi';
import { formatUnits } from 'viem';
import { TokenSelector } from './TokenSelector';
import { DepositTracker } from './DepositTracker';
import { ChainStatus } from './ChainStatus';
import { useBridge } from '@/hooks/useBridge';
import { getTokensForChain, Token } from '@/config/tokens';
import { getDestChainId, chainLabel } from '@/config/chainUtils';
import config from '@/config/bridge-config.json';

// Build chain list from config for the chain selector
const CHAIN_LIST = Object.entries(config.chains).map(([id, chain]) => ({
  id: Number(id),
  label: (chain as any).label as string,
  name: (chain as any).name as string,
}));

export function BridgeForm() {
  const { address, isConnected } = useAccount();
  const [sourceChainId, setSourceChainId] = useState(CHAIN_LIST[0].id);
  const [token, setToken] = useState<Token | null>(null);
  const [amount, setAmount] = useState('');

  const targetChainId = getDestChainId(sourceChainId);
  const tokens = useMemo(() => getTokensForChain(sourceChainId), [sourceChainId]);
  const { bridge, status, txHash, releaseTxHash, depositBlock, error, reset, confirmations, requiredConfirmations, sourceChainId: bridgeSourceChainId } = useBridge();

  const tokenAddr = token && !token.isNative ? token.addresses[sourceChainId] : undefined;
  const { data: balance } = useBalance({
    address,
    token: tokenAddr as `0x${string}` | undefined,
    chainId: sourceChainId,
    query: { enabled: isConnected && !!token },
  });

  const handleSwapDirection = () => {
    setSourceChainId(targetChainId);
    setToken(null);
    setAmount('');
    reset();
  };

  const handleSourceChange = (newSourceId: number) => {
    if (newSourceId === sourceChainId) return;
    setSourceChainId(newSourceId);
    setToken(null);
    setAmount('');
    reset();
  };

  const handleReset = () => {
    setAmount('');
    reset();
  };

  const feeNum = amount ? parseFloat(amount) * 0.006 : 0;
  const receiveNum = amount ? parseFloat(amount) * 0.994 : 0;
  const precision = feeNum > 0 && feeNum < 0.000001 ? 10 : feeNum < 0.01 ? 8 : 6;
  const fee = feeNum.toFixed(precision);
  const receive = receiveNum.toFixed(precision);
  const isActive = status !== 'idle' && status !== 'released' && status !== 'error';

  const handleBridge = () => {
    if (!token || !amount) return;
    bridge(sourceChainId, token, amount);
  };

  const receiveSymbol = token?.symbol || '';

  const buttonText = () => {
    if (!isConnected) return 'Connect Wallet';
    if (!token) return 'Select Token';
    if (!amount || parseFloat(amount) <= 0) return 'Enter Amount';
    switch (status) {
      case 'switching': return 'Switching Chain...';
      case 'approving': return 'Approving...';
      case 'depositing': return 'Confirm in Wallet...';
      case 'confirming': return 'Confirming...';
      case 'waiting_relayer': return 'Waiting for Release...';
      default: return 'Bridge';
    }
  };

  const sourceLabel = chainLabel(sourceChainId);
  const targetLabel = chainLabel(targetChainId);

  return (
    <div className="space-y-4">
      <div className="text-center mb-2">
        <h1 className="text-2xl font-sans font-bold text-white">Bridge</h1>
      </div>

      <div className="bg-card rounded-2xl border border-gray-800 overflow-hidden">
        {/* FROM section */}
        <div className="p-4 pb-2">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-gray-500 uppercase tracking-wider">From</span>
            <ChainPill
              chainId={sourceChainId}
              chains={CHAIN_LIST}
              onChange={handleSourceChange}
              disabled={isActive}
            />
          </div>
          <TokenSelector tokens={tokens} selected={token} onSelect={setToken} sourceChainId={sourceChainId} disabled={isActive} />
          <div className="mt-3">
            <div className="flex items-center bg-bg-dark rounded-xl border border-gray-700/50 px-4 py-3">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0"
                disabled={isActive}
                className="flex-1 bg-transparent text-white text-xl font-mono focus:outline-none disabled:opacity-50 min-w-0"
              />
              {balance && (
                <button
                  onClick={() => setAmount(formatUnits(balance.value, balance.decimals))}
                  className="text-xs text-accent hover:text-accent-dim ml-2 px-2 py-1 rounded bg-accent/10 border border-accent/30 shrink-0"
                >
                  MAX
                </button>
              )}
            </div>
            {balance && (
              <p className="text-[11px] text-gray-600 mt-1 text-right font-mono">
                Balance: {parseFloat(formatUnits(balance.value, balance.decimals)).toFixed(4)} {token?.symbol}
              </p>
            )}
          </div>
        </div>

        {/* Swap direction button */}
        <div className="relative h-0 flex justify-center z-10">
          <button
            onClick={handleSwapDirection}
            disabled={isActive}
            className="absolute -translate-y-1/2 w-9 h-9 rounded-lg bg-card border-2 border-gray-700 flex items-center justify-center text-gray-400 hover:text-accent hover:border-accent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M7 1L7 13M7 13L3 9M7 13L11 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        {/* TO section */}
        <div className="p-4 pt-5 border-t border-gray-800/50">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-gray-500 uppercase tracking-wider">To</span>
            <span className="text-xs font-semibold text-accent bg-accent/10 border border-accent/30 px-3 py-1 rounded-full">
              {targetLabel}
            </span>
          </div>
          <div className="bg-bg-dark rounded-xl border border-gray-700/50 px-4 py-3">
            <div className="flex items-center justify-between">
              <span className={`text-xl font-mono ${receiveNum > 0 ? 'text-white' : 'text-gray-600'}`}>
                {receiveNum > 0 ? receive : '0.0'}
              </span>
              {token && (
                <span className="text-sm text-gray-400 font-medium">{receiveSymbol}</span>
              )}
            </div>
          </div>
        </div>

        {/* Fee info */}
        {amount && parseFloat(amount) > 0 && (
          <div className="px-4 pb-3">
            <div className="flex justify-between text-xs text-gray-500">
              <span>Fee (0.6%)</span>
              <span className="font-mono">{fee} {token?.symbol}</span>
            </div>
          </div>
        )}

        {/* Bridge Button */}
        <div className="p-4 pt-2">
          <button
            onClick={handleBridge}
            disabled={!isConnected || !token || !amount || parseFloat(amount) <= 0 || isActive}
            className="w-full py-3.5 rounded-xl font-sans font-semibold text-base transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-accent text-bg-dark hover:bg-accent-dim"
          >
            {buttonText()}
          </button>
        </div>
      </div>

      {/* Status Tracker */}
      <DepositTracker status={status} txHash={txHash} releaseTxHash={releaseTxHash} sourceChainId={bridgeSourceChainId} depositBlock={depositBlock} error={error} onReset={handleReset} confirmations={confirmations} requiredConfirmations={requiredConfirmations} />

      {/* Chain Block Heights */}
      <ChainStatus />
    </div>
  );
}

/** Chain selector pill — dropdown when multiple chains */
function ChainPill({
  chainId,
  chains,
  onChange,
  disabled,
}: {
  chainId: number;
  chains: typeof CHAIN_LIST;
  onChange: (id: number) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = chains.find((c) => c.id === chainId);

  // Only 2 chains? Just show a button that swaps
  if (chains.length <= 2) {
    return (
      <button
        onClick={() => {
          const other = chains.find((c) => c.id !== chainId);
          if (other) onChange(other.id);
        }}
        disabled={disabled}
        className={`text-xs font-semibold px-3 py-1 rounded-full border transition-colors disabled:opacity-50 ${
          chainId === 56
            ? 'bg-[#F3BA2F]/10 border-[#F3BA2F]/30 text-[#F3BA2F] hover:bg-[#F3BA2F]/20'
            : 'bg-accent/10 border-accent/30 text-accent hover:bg-accent/20'
        }`}
      >
        {current?.label || `Chain ${chainId}`}
      </button>
    );
  }

  // Multiple chains: dropdown
  return (
    <div className="relative">
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="text-xs font-semibold px-3 py-1 rounded-full border transition-colors disabled:opacity-50 bg-accent/10 border-accent/30 text-accent hover:bg-accent/20 flex items-center gap-1"
      >
        {current?.label || `Chain ${chainId}`}
        <span className="text-[10px]">&#9662;</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-card border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden min-w-[140px]">
          {chains.map((c) => (
            <button
              key={c.id}
              onClick={() => { onChange(c.id); setOpen(false); }}
              className={`w-full px-4 py-2 text-left text-xs hover:bg-white/5 transition-colors ${
                c.id === chainId ? 'text-accent bg-accent/10' : 'text-gray-300'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
