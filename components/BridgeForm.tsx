'use client';

import { useState } from 'react';
import { useAccount, useBalance } from 'wagmi';
import { formatUnits } from 'viem';
import { ChainSelector } from './ChainSelector';
import { TokenSelector } from './TokenSelector';
import { DepositTracker } from './DepositTracker';
import { useBridge } from '@/hooks/useBridge';
import { getTokensForChain, Token } from '@/config/tokens';

export function BridgeForm() {
  const { address, isConnected } = useAccount();
  const [chainId, setChainId] = useState(1);
  const [token, setToken] = useState<Token | null>(null);
  const [amount, setAmount] = useState('');

  const tokens = getTokensForChain(chainId);
  const { bridge, status, txHash, error, reset } = useBridge();

  // Get balance for selected token
  const tokenAddr = token && !token.isNative ? token.addresses[chainId] : undefined;
  const { data: balance } = useBalance({
    address,
    token: tokenAddr as `0x${string}` | undefined,
    chainId,
    query: { enabled: isConnected && !!token },
  });

  const handleChainChange = (id: number) => {
    setChainId(id);
    setToken(null);
    setAmount('');
    reset();
  };

  const fee = amount ? (parseFloat(amount) * 0.006).toFixed(token?.decimals === 6 ? 4 : 6) : '0';
  const receive = amount ? (parseFloat(amount) * 0.994).toFixed(token?.decimals === 6 ? 4 : 6) : '0';

  const handleBridge = () => {
    if (!token || !amount) return;
    bridge(chainId, token, amount);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-3xl font-sans font-bold text-white mb-2">Bridge to BlockDAG</h1>
        <p className="text-gray-400 text-sm">Transfer tokens from any chain to BlockDAG Network</p>
      </div>

      <div className="bg-card rounded-2xl p-6 border border-gray-800">
        {/* Source Chain */}
        <label className="block text-xs text-gray-500 uppercase tracking-wider mb-2">From Network</label>
        <ChainSelector selectedChainId={chainId} onSelect={handleChainChange} />

        {/* Destination (fixed) */}
        <div className="mt-4 flex items-center gap-2 text-sm text-gray-400">
          <span className="text-xs uppercase tracking-wider">To:</span>
          <span className="px-3 py-1 rounded-lg bg-accent/10 text-accent border border-accent/30 text-sm font-semibold">
            BlockDAG (1404)
          </span>
        </div>

        {/* Token */}
        <div className="mt-5">
          <label className="block text-xs text-gray-500 uppercase tracking-wider mb-2">Token</label>
          <TokenSelector tokens={tokens} selected={token} onSelect={setToken} />
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
            className="w-full bg-bg-dark border border-gray-700 rounded-lg px-4 py-3 text-white text-lg focus:border-accent focus:outline-none"
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
              <span>{receive} w{token?.symbol}</span>
            </div>
          </div>
        )}

        {/* Bridge Button */}
        <button
          onClick={handleBridge}
          disabled={!isConnected || !token || !amount || parseFloat(amount) <= 0 || status !== 'idle'}
          className="mt-5 w-full py-4 rounded-xl font-sans font-semibold text-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-accent text-bg-dark hover:bg-accent-dim"
        >
          {!isConnected
            ? 'Connect Wallet'
            : !token
            ? 'Select Token'
            : !amount || parseFloat(amount) <= 0
            ? 'Enter Amount'
            : status !== 'idle'
            ? 'Bridging...'
            : 'Bridge to BlockDAG'
          }
        </button>
      </div>

      {/* Status Tracker */}
      <DepositTracker status={status} txHash={txHash} error={error} />
    </div>
  );
}
