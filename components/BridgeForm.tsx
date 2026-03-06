'use client';

import { useState } from 'react';
import { useAccount, useBalance } from 'wagmi';
import { formatUnits } from 'viem';
import { TokenSelector } from './TokenSelector';
import { DepositTracker } from './DepositTracker';
import { useBridge } from '@/hooks/useBridge';
import { getTokensForChain, Token } from '@/config/tokens';

type Direction = 'bsc_to_bdag' | 'bdag_to_bsc';

export function BridgeForm() {
  const { address, isConnected } = useAccount();
  const [direction, setDirection] = useState<Direction>('bsc_to_bdag');
  const [token, setToken] = useState<Token | null>(null);
  const [amount, setAmount] = useState('');

  const sourceChainId = direction === 'bsc_to_bdag' ? 56 : 1404;
  const targetChainId = direction === 'bsc_to_bdag' ? 1404 : 56;
  const tokens = getTokensForChain(sourceChainId);
  const { bridge, status, txHash, releaseTxHash, error, reset, confirmations, requiredConfirmations, sourceChainId: bridgeSourceChainId } = useBridge();

  const tokenAddr = token && !token.isNative ? token.addresses[sourceChainId] : undefined;
  const { data: balance } = useBalance({
    address,
    token: tokenAddr as `0x${string}` | undefined,
    chainId: sourceChainId,
    query: { enabled: isConnected && !!token },
  });

  const handleDirectionSwap = () => {
    setDirection(d => d === 'bsc_to_bdag' ? 'bdag_to_bsc' : 'bsc_to_bdag');
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
  // Use more decimals for small amounts so fee/receive don't round to zero
  const precision = feeNum > 0 && feeNum < 0.000001 ? 10 : feeNum < 0.01 ? 8 : 6;
  const fee = feeNum.toFixed(precision);
  const receive = receiveNum.toFixed(precision);
  const isActive = status !== 'idle' && status !== 'released' && status !== 'error';

  const handleBridge = () => {
    if (!token || !amount) return;
    bridge(sourceChainId, token, amount);
  };

  const receiveSymbol = direction === 'bsc_to_bdag'
    ? `w${token?.symbol || ''}`
    : token?.symbol || '';

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

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-sans font-bold text-white mb-2">BDAG Bridge</h1>
        <p className="text-gray-400 text-sm">Transfer tokens between BNB Chain and BlockDAG</p>
      </div>

      <div className="bg-card rounded-2xl p-6 border border-gray-800">
        {/* Direction selector */}
        <div className="flex items-center gap-3 justify-center mb-6">
          <div className={`px-4 py-2 rounded-lg text-sm font-semibold border ${
            direction === 'bsc_to_bdag'
              ? 'bg-[#F3BA2F]/10 border-[#F3BA2F]/40 text-[#F3BA2F]'
              : 'bg-accent/10 border-accent/40 text-accent'
          }`}>
            {direction === 'bsc_to_bdag' ? 'BNB Chain' : 'BlockDAG'}
          </div>

          <button
            onClick={handleDirectionSwap}
            disabled={isActive}
            className="w-10 h-10 rounded-full border border-gray-600 flex items-center justify-center text-gray-400 hover:text-accent hover:border-accent transition-colors disabled:opacity-40"
          >
            ⇄
          </button>

          <div className={`px-4 py-2 rounded-lg text-sm font-semibold border ${
            direction === 'bsc_to_bdag'
              ? 'bg-accent/10 border-accent/40 text-accent'
              : 'bg-[#F3BA2F]/10 border-[#F3BA2F]/40 text-[#F3BA2F]'
          }`}>
            {direction === 'bsc_to_bdag' ? 'BlockDAG' : 'BNB Chain'}
          </div>
        </div>

        {/* Token */}
        <div>
          <label className="block text-xs text-gray-500 uppercase tracking-wider mb-2">Token</label>
          <TokenSelector tokens={tokens} selected={token} onSelect={setToken} sourceChainId={sourceChainId} disabled={isActive} />
        </div>

        {/* Amount */}
        <div className="mt-5">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs text-gray-500 uppercase tracking-wider">Amount</label>
            {balance && (
              <button
                onClick={() => setAmount(formatUnits(balance.value, balance.decimals))}
                className="text-xs text-accent hover:text-accent-dim"
              >
                Max: {parseFloat(formatUnits(balance.value, balance.decimals)).toFixed(4)}
              </button>
            )}
          </div>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            disabled={isActive}
            className="w-full bg-bg-dark border border-gray-700 rounded-lg px-4 py-3 text-white text-lg focus:border-accent focus:outline-none disabled:opacity-50"
          />
        </div>

        {/* Fee Preview */}
        {amount && parseFloat(amount) > 0 && (
          <div className="mt-4 bg-bg-dark rounded-lg p-3 space-y-1 text-sm">
            <div className="flex justify-between text-gray-400">
              <span>Bridge Fee (0.6%)</span>
              <span>{fee} {token?.symbol}</span>
            </div>
            <div className="flex justify-between text-white font-semibold">
              <span>You Receive</span>
              <span>{receive} {receiveSymbol}</span>
            </div>
          </div>
        )}

        {/* Bridge Button */}
        <button
          onClick={handleBridge}
          disabled={!isConnected || !token || !amount || parseFloat(amount) <= 0 || isActive}
          className="mt-5 w-full py-4 rounded-xl font-sans font-semibold text-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-accent text-bg-dark hover:bg-accent-dim"
        >
          {buttonText()}
        </button>
      </div>

      {/* Status Tracker */}
      <DepositTracker status={status} txHash={txHash} releaseTxHash={releaseTxHash} sourceChainId={bridgeSourceChainId} error={error} onReset={handleReset} confirmations={confirmations} requiredConfirmations={requiredConfirmations} />
    </div>
  );
}
