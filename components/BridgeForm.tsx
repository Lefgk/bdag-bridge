'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useAccount, useBalance } from 'wagmi';
import { formatUnits, parseUnits } from 'viem';
import { TokenSelector } from './TokenSelector';
import { DepositTracker } from './DepositTracker';
import { ChainStatus } from './ChainStatus';
import { useBridge } from '@/hooks/useBridge';
import { CONTRACTS } from '@/config/contracts';
import { getTokensForChain, Token, getDecimals } from '@/config/tokens';
import { getDestinationChains, isPlaceholderAddress, getRpc, rpcCall } from '@/config/chainUtils';
import config from '@/config/bridge-config.json';

// Build chain list from config for the chain selector
const CHAIN_LIST = Object.entries(config.chains).map(([id, chain]) => ({
  id: Number(id),
  label: (chain as any).label as string,
  name: (chain as any).name as string,
  icon: (chain as any).icon as string | undefined,
}));

export function BridgeForm() {
  const { address, isConnected } = useAccount();
  const [sourceChainId, setSourceChainId] = useState(CHAIN_LIST[0].id);
  const [targetChainIdOverride, setTargetChainIdOverride] = useState<number | null>(null);
  const [token, setToken] = useState<Token | null>(null);
  const [amount, setAmount] = useState('');
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const destChains = useMemo(() => getDestinationChains(sourceChainId), [sourceChainId]);
  const targetChainId = targetChainIdOverride && destChains.includes(targetChainIdOverride)
    ? targetChainIdOverride
    : destChains[0];
  const tokens = useMemo(() => getTokensForChain(sourceChainId, targetChainId), [sourceChainId, targetChainId]);
  const { bridge, status, txHash, messageId, depositBlock, error, reset, confirmations, requiredConfirmations, sourceChainId: bridgeSourceChainId, destChainId: bridgeDestChainId } = useBridge();

  const tokenAddr = token && !token.isNative ? token.addresses[sourceChainId] : undefined;
  const { data: balance } = useBalance({
    address,
    token: tokenAddr as `0x${string}` | undefined,
    chainId: sourceChainId,
    query: { enabled: isConnected && !!token },
  });

  // Quote protocol fee
  const amountParsed = useMemo(() => {
    if (!token || !amount || parseFloat(amount) <= 0) return undefined;
    try { return parseUnits(amount, getDecimals(token, sourceChainId)); } catch { return undefined; }
  }, [token, amount, sourceChainId]);

  const [protocolFeeNum, setProtocolFeeNum] = useState(0);

  useEffect(() => {
    if (!amountParsed || !token) {
      setProtocolFeeNum(0);
      return;
    }
    // Default 0.6% protocol fee estimate
    setProtocolFeeNum(parseFloat(amount) * 0.006);
    setIgpFeeNum(0);

    const bridgeAddr = CONTRACTS[sourceChainId]?.bridge;
    if (!bridgeAddr || isPlaceholderAddress(bridgeAddr)) return;

    // Fetch real fee rate from bridge contract
    const fetchFees = async () => {
      try {
        const rpc = getRpc(sourceChainId);
        const tkAddr = token.isNative ? '0x0000000000000000000000000000000000000000' : token.addresses[sourceChainId];

        // Check hasCustomFee(token) - selector 0x721eaecd
        const hasCustomData = '0x721eaecd' + tkAddr.slice(2).padStart(64, '0');
        const hasCustomResult = await rpcCall(rpc, 'eth_call', [{ to: bridgeAddr, data: hasCustomData }, 'latest'], 5000);
        const hasCustom = hasCustomResult && hasCustomResult !== '0x' + '0'.repeat(64);

        let feeRate: bigint;
        if (hasCustom) {
          // bridgeFees(token) - selector 0x58db2eef
          const feeData = '0x58db2eef' + tkAddr.slice(2).padStart(64, '0');
          const feeResult = await rpcCall(rpc, 'eth_call', [{ to: bridgeAddr, data: feeData }, 'latest'], 5000);
          feeRate = BigInt(feeResult);
        } else {
          // defaultBridgeFee() - selector 0x6ced0c92
          const feeResult = await rpcCall(rpc, 'eth_call', [{ to: bridgeAddr, data: '0x6ced0c92' }, 'latest'], 5000);
          feeRate = BigInt(feeResult);
        }

        // feeRate is in PPM (parts per million), so fee% = feeRate / 1_000_000
        const feePercent = Number(feeRate) / 1_000_000;
        setProtocolFeeNum(parseFloat(amount) * feePercent);
      } catch { /* use default 0.6% */ }
    };
    fetchFees();
  }, [amountParsed, token, sourceChainId, targetChainId, address, amount]);

  const handleSwapDirection = () => {
    setSourceChainId(targetChainId);
    setTargetChainIdOverride(sourceChainId);
    setToken(null);
    setAmount('');
    reset();
  };

  const handleSourceChange = (newSourceId: number) => {
    if (newSourceId === sourceChainId) return;
    setSourceChainId(newSourceId);
    setTargetChainIdOverride(null);
    setToken(null);
    setAmount('');
    reset();
  };

  const handleTargetChange = (newTargetId: number) => {
    if (newTargetId === targetChainId) return;
    setTargetChainIdOverride(newTargetId);
    setToken(null);
    setAmount('');
  };

  const handleReset = () => {
    setAmount('');
    reset();
  };

  const decimals = token ? getDecimals(token, sourceChainId) : 18;
  const receiveNum = amount ? parseFloat(amount) - protocolFeeNum : 0;
  const precision = protocolFeeNum > 0 && protocolFeeNum < 0.000001 ? 10 : protocolFeeNum < 0.01 ? 8 : 6;
  const fee = protocolFeeNum.toFixed(precision);
  const receive = receiveNum > 0 ? receiveNum.toFixed(precision) : '0';
  const isActive = status !== 'idle' && status !== 'delivered' && status !== 'error';

  const chainContracts = CONTRACTS[sourceChainId];
  const notDeployed = !chainContracts || isPlaceholderAddress(chainContracts.bridge);

  const bridgingRef = useRef(false);
  const handleBridge = () => {
    if (!token || !amount || bridgingRef.current) return;
    bridgingRef.current = true;
    bridge(sourceChainId, token, amount, targetChainId).finally(() => { bridgingRef.current = false; });
  };

  const receiveSymbol = token?.symbol || '';

  const buttonText = () => {
    if (!mounted || !isConnected) return 'Connect Wallet';
    if (notDeployed) return 'Bridge Not Deployed';
    if (!token) return 'Select Token';
    if (!amount || parseFloat(amount) <= 0) return 'Enter Amount';
    switch (status) {
      case 'switching': return 'Switching Chain...';
      case 'approving': return 'Approving...';
      case 'depositing': return 'Confirm in Wallet...';
      case 'confirming': return 'Confirming...';
      case 'waiting_delivery': return 'Waiting for Delivery...';
      default: return 'Bridge';
    }
  };

  const targetIcon = (config.chains[String(targetChainId) as keyof typeof config.chains] as any)?.icon;

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
            <ChainPill
              chainId={targetChainId}
              chains={CHAIN_LIST.filter(c => destChains.includes(c.id))}
              onChange={handleTargetChange}
              disabled={isActive}
            />
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

        {/* Fee info — dual display */}
        {amount && parseFloat(amount) > 0 && (
          <div className="px-4 pb-3 space-y-1">
            <div className="flex justify-between text-xs text-gray-500">
              <span>Protocol Fee (0.6%)</span>
              <span className="font-mono">{fee} {token?.symbol}</span>
            </div>
          </div>
        )}

        {/* Bridge Button */}
        <div className="p-4 pt-2">
          <button
            onClick={handleBridge}
            disabled={!mounted || !isConnected || !token || !amount || parseFloat(amount) <= 0 || isActive || notDeployed}
            className="w-full py-3.5 rounded-xl font-sans font-semibold text-base transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-accent text-bg-dark hover:bg-accent-dim"
            suppressHydrationWarning
          >
            {buttonText()}
          </button>
        </div>
      </div>

      {/* Status Tracker */}
      <DepositTracker
        status={status}
        txHash={txHash}
        messageId={messageId}
        sourceChainId={bridgeSourceChainId}
        destChainId={bridgeDestChainId}
        depositBlock={depositBlock}
        error={error}
        onReset={handleReset}
        confirmations={confirmations}
        requiredConfirmations={requiredConfirmations}
      />

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
  const ref = useRef<HTMLDivElement>(null);
  const current = chains.find((c) => c.id === chainId);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="text-xs font-semibold px-3 py-1 rounded-full border transition-colors disabled:opacity-50 bg-accent/10 border-accent/30 text-accent hover:bg-accent/20 flex items-center gap-1.5"
      >
        {current?.icon && <img src={current.icon} alt="" className="w-4 h-4 rounded-full" />}
        {current?.label || `Chain ${chainId}`}
        <span className="text-[10px]">&#9662;</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-card border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden min-w-[160px] max-h-[300px] overflow-y-auto">
          {chains.map((c) => (
            <button
              key={c.id}
              onClick={() => { onChange(c.id); setOpen(false); }}
              className={`w-full px-4 py-2 text-left text-xs hover:bg-white/5 transition-colors flex items-center gap-2 ${
                c.id === chainId ? 'text-accent bg-accent/10' : 'text-gray-300'
              }`}
            >
              {c.icon && <img src={c.icon} alt="" className="w-4 h-4 rounded-full" />}
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
