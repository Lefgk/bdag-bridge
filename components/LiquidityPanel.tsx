'use client';

import { useState } from 'react';
import { useAccount, useBalance, useReadContract } from 'wagmi';
import { formatUnits, parseUnits } from 'viem';
import { ChainSelector } from './ChainSelector';
import { TokenSelector } from './TokenSelector';
import { useLiquidity } from '@/hooks/useLiquidity';
import { getTokensForChain, Token } from '@/config/tokens';
import { CONTRACTS } from '@/config/contracts';
import { ROUTER_ABI, ERC20_ABI } from '@/lib/abi';

export function LiquidityPanel() {
  const { address, isConnected } = useAccount();
  const [chainId, setChainId] = useState(1);
  const [token, setToken] = useState<Token | null>(null);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<'add' | 'remove'>('add');

  const tokens = getTokensForChain(chainId).filter(t => !t.isNative);
  const { addLiquidity, removeLiquidity, loading, error } = useLiquidity();

  // Get LP token address
  const tokenAddr = token ? token.addresses[chainId] : undefined;
  const contracts = CONTRACTS[chainId];
  const { data: lpTokenAddr } = useReadContract({
    address: contracts?.router,
    abi: ROUTER_ABI,
    functionName: 'getLPToken',
    args: [tokenAddr as `0x${string}`],
    query: { enabled: !!tokenAddr && !!contracts },
  });

  // Get LP balance
  const { data: lpBalance } = useReadContract({
    address: lpTokenAddr as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address as `0x${string}`],
    query: { enabled: !!lpTokenAddr && lpTokenAddr !== '0x0000000000000000000000000000000000000000' && !!address },
  });

  // Get token balance
  const { data: tokenBalance } = useBalance({
    address,
    token: tokenAddr as `0x${string}`,
    chainId,
    query: { enabled: isConnected && !!tokenAddr },
  });

  // Get pool balance (tokens locked in bridge)
  const { data: poolBalance } = useReadContract({
    address: tokenAddr as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [contracts?.bridgeERC20 as `0x${string}`],
    query: { enabled: !!tokenAddr && !!contracts?.bridgeERC20 },
  });

  // Get LP total supply
  const { data: lpTotalSupply } = useReadContract({
    address: lpTokenAddr as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'totalSupply',
    query: { enabled: !!lpTokenAddr && lpTokenAddr !== '0x0000000000000000000000000000000000000000' },
  });

  const handleChainChange = (id: number) => {
    setChainId(id);
    setToken(null);
    setAmount('');
  };

  const handleSubmit = () => {
    if (!token || !amount) return;
    if (mode === 'add') {
      addLiquidity(chainId, token, amount);
    } else {
      removeLiquidity(chainId, token, amount);
    }
  };

  const lpBalFormatted = lpBalance ? formatUnits(lpBalance as bigint, 18) : '0';
  const poolBalFormatted = poolBalance && token ? formatUnits(poolBalance as bigint, token.decimals) : '0';
  const lpSupplyFormatted = lpTotalSupply ? formatUnits(lpTotalSupply as bigint, 18) : '0';
  const yourShare = lpTotalSupply && lpBalance && (lpTotalSupply as bigint) > 0n
    ? ((Number(lpBalance) / Number(lpTotalSupply)) * 100).toFixed(2)
    : '0';

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-sans font-bold text-white mb-2">Liquidity</h1>
        <p className="text-gray-400 text-sm">Provide liquidity on source chains and earn 0.6% bridge fees</p>
      </div>

      <div className="bg-card rounded-2xl p-6 border border-gray-800">
        {/* Mode Toggle */}
        <div className="flex gap-1 bg-bg-dark rounded-lg p-1 mb-5">
          <button
            onClick={() => setMode('add')}
            className={`flex-1 py-2 rounded-md text-sm font-semibold transition-colors ${
              mode === 'add' ? 'bg-accent text-bg-dark' : 'text-gray-400'
            }`}
          >
            Add Liquidity
          </button>
          <button
            onClick={() => setMode('remove')}
            className={`flex-1 py-2 rounded-md text-sm font-semibold transition-colors ${
              mode === 'remove' ? 'bg-accent text-bg-dark' : 'text-gray-400'
            }`}
          >
            Remove Liquidity
          </button>
        </div>

        {/* Chain */}
        <label className="block text-xs text-gray-500 uppercase tracking-wider mb-2">Network</label>
        <ChainSelector selectedChainId={chainId} onSelect={handleChainChange} />

        {/* Token */}
        <div className="mt-5">
          <label className="block text-xs text-gray-500 uppercase tracking-wider mb-2">Token</label>
          <TokenSelector tokens={tokens} selected={token} onSelect={setToken} />
        </div>

        {/* Amount */}
        <div className="mt-5">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs text-gray-500 uppercase tracking-wider">
              {mode === 'add' ? 'Amount' : 'LP Amount'}
            </label>
            {mode === 'add' && tokenBalance && (
              <button
                onClick={() => setAmount(formatUnits(tokenBalance.value, tokenBalance.decimals))}
                className="text-xs text-accent hover:text-accent-dim"
              >
                Max: {parseFloat(formatUnits(tokenBalance.value, tokenBalance.decimals)).toFixed(4)}
              </button>
            )}
            {mode === 'remove' && lpBalance && (
              <button
                onClick={() => setAmount(formatUnits(lpBalance as bigint, 18))}
                className="text-xs text-accent hover:text-accent-dim"
              >
                Max: {parseFloat(lpBalFormatted).toFixed(4)}
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

        {/* Pool Stats */}
        {token && (
          <div className="mt-4 bg-bg-dark rounded-lg p-3 space-y-1 text-sm">
            <div className="flex justify-between text-gray-400">
              <span>Pool Balance</span>
              <span>{parseFloat(poolBalFormatted).toFixed(4)} {token.symbol}</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>Total LP Supply</span>
              <span>{parseFloat(lpSupplyFormatted).toFixed(4)}</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>Your LP Balance</span>
              <span>{parseFloat(lpBalFormatted).toFixed(4)}</span>
            </div>
            <div className="flex justify-between text-white font-semibold">
              <span>Your Share</span>
              <span>{yourShare}%</span>
            </div>
            {mode === 'remove' && (
              <div className="flex justify-between text-yellow-400 text-xs pt-1 border-t border-gray-700">
                <span>Withdrawal Fee</span>
                <span>0.3%</span>
              </div>
            )}
          </div>
        )}

        {/* Submit Button */}
        <button
          onClick={handleSubmit}
          disabled={!isConnected || !token || !amount || parseFloat(amount) <= 0 || loading}
          className="mt-5 w-full py-4 rounded-xl font-sans font-semibold text-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-accent text-bg-dark hover:bg-accent-dim"
        >
          {!isConnected
            ? 'Connect Wallet'
            : loading
            ? 'Processing...'
            : mode === 'add'
            ? 'Add Liquidity'
            : 'Remove Liquidity'
          }
        </button>

        {error && (
          <p className="mt-3 text-xs text-red-400">{error}</p>
        )}
      </div>
    </div>
  );
}
