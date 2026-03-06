'use client';

import { useState } from 'react';
import { useAccount, useWriteContract, useReadContract } from 'wagmi';
import { CONTRACTS } from '@/config/contracts';
import { SOURCE_CHAINS } from '@/config/chains';

const ADMIN_ADDR = '0x4Ae60b47174e94b8c187172886E6a4D322817760';

// Minimal ABIs for admin functions
const BRIDGE_ERC20_ADMIN_ABI = [
  { inputs: [], name: 'paused', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'relayer', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'defaultBridgeFee', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'admin', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: '_relayer', type: 'address' }], name: 'setRelayer', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: '_fee', type: 'uint256' }], name: 'setDefaultBridgeFee', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: '_token', type: 'address' }, { name: '_fee', type: 'uint256' }], name: 'setTokenBridgeFee', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: '_sourceToken', type: 'address' }, { name: '_wrappedToken', type: 'address' }], name: 'setPeggedToken', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: '_newAdmin', type: 'address' }], name: 'proposeAdmin', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'acceptAdmin', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'pause', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'unpause', outputs: [], stateMutability: 'nonpayable', type: 'function' },
] as const;

const ROUTER_ADMIN_ABI = [
  { inputs: [], name: 'paused', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'pause', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'unpause', outputs: [], stateMutability: 'nonpayable', type: 'function' },
] as const;

const LM_ADMIN_ABI = [
  { inputs: [], name: 'paused', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'defaultLiquidityWithdrawalFee', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: '_fee', type: 'uint256' }], name: 'setDefaultWithdrawalFee', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: '_token', type: 'address' }, { name: '_fee', type: 'uint256' }], name: 'setTokenWithdrawalFee', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'pause', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'unpause', outputs: [], stateMutability: 'nonpayable', type: 'function' },
] as const;

function Toast({ message, type }: { message: string; type: 'success' | 'error' }) {
  return (
    <div className={`fixed top-20 right-4 z-50 px-4 py-3 rounded-lg text-sm font-mono shadow-lg border ${
      type === 'success'
        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
        : 'bg-red-500/10 border-red-500/30 text-red-400'
    }`}>
      {message}
    </div>
  );
}

export default function AdminPage() {
  const { address, isConnected, chainId } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const contracts = chainId ? CONTRACTS[chainId] : undefined;

  // Toast state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Form state
  const [relayerAddr, setRelayerAddr] = useState('');
  const [defaultFee, setDefaultFee] = useState('');
  const [tokenFeeAddr, setTokenFeeAddr] = useState('');
  const [tokenFeeVal, setTokenFeeVal] = useState('');
  const [withdrawalFee, setWithdrawalFee] = useState('');
  const [newAdminAddr, setNewAdminAddr] = useState('');
  const [srcToken, setSrcToken] = useState('');
  const [wrappedToken, setWrappedToken] = useState('');

  // Read contract state
  const { data: routerPaused } = useReadContract({
    address: contracts?.router, abi: ROUTER_ADMIN_ABI, functionName: 'paused',
    query: { enabled: !!contracts },
  });
  const { data: bridgePaused } = useReadContract({
    address: contracts?.bridgeERC20, abi: BRIDGE_ERC20_ADMIN_ABI, functionName: 'paused',
    query: { enabled: !!contracts },
  });
  const { data: lmPaused } = useReadContract({
    address: contracts?.liquidityManager, abi: LM_ADMIN_ABI, functionName: 'paused',
    query: { enabled: !!contracts },
  });
  const { data: currentRelayer } = useReadContract({
    address: contracts?.bridgeERC20, abi: BRIDGE_ERC20_ADMIN_ABI, functionName: 'relayer',
    query: { enabled: !!contracts },
  });
  const { data: currentBridgeFee } = useReadContract({
    address: contracts?.bridgeERC20, abi: BRIDGE_ERC20_ADMIN_ABI, functionName: 'defaultBridgeFee',
    query: { enabled: !!contracts },
  });
  const { data: currentWithdrawalFee } = useReadContract({
    address: contracts?.liquidityManager, abi: LM_ADMIN_ABI, functionName: 'defaultLiquidityWithdrawalFee',
    query: { enabled: !!contracts },
  });

  const isAdmin = address?.toLowerCase() === ADMIN_ADDR.toLowerCase();
  const chainName = SOURCE_CHAINS.find(c => c.id === chainId)?.label || (chainId === 1404 ? 'BlockDAG' : `Chain ${chainId}`);

  // ── Admin actions ──
  async function doSetRelayer() {
    if (!relayerAddr || !contracts) return;
    try {
      await writeContractAsync({ address: contracts.bridgeERC20, abi: BRIDGE_ERC20_ADMIN_ABI, functionName: 'setRelayer', args: [relayerAddr as `0x${string}`] });
      showToast('Relayer updated', 'success');
    } catch (e: any) { showToast(e.shortMessage || e.message, 'error'); }
  }

  async function doSetDefaultFee() {
    if (!defaultFee || !contracts) return;
    try {
      await writeContractAsync({ address: contracts.bridgeERC20, abi: BRIDGE_ERC20_ADMIN_ABI, functionName: 'setDefaultBridgeFee', args: [BigInt(defaultFee)] });
      showToast('Default bridge fee updated', 'success');
    } catch (e: any) { showToast(e.shortMessage || e.message, 'error'); }
  }

  async function doSetTokenFee() {
    if (!tokenFeeAddr || !tokenFeeVal || !contracts) return;
    try {
      await writeContractAsync({ address: contracts.bridgeERC20, abi: BRIDGE_ERC20_ADMIN_ABI, functionName: 'setTokenBridgeFee', args: [tokenFeeAddr as `0x${string}`, BigInt(tokenFeeVal)] });
      showToast('Token fee updated', 'success');
    } catch (e: any) { showToast(e.shortMessage || e.message, 'error'); }
  }

  async function doSetWithdrawalFee() {
    if (!withdrawalFee || !contracts) return;
    try {
      await writeContractAsync({ address: contracts.liquidityManager, abi: LM_ADMIN_ABI, functionName: 'setDefaultWithdrawalFee', args: [BigInt(withdrawalFee)] });
      showToast('Withdrawal fee updated', 'success');
    } catch (e: any) { showToast(e.shortMessage || e.message, 'error'); }
  }

  async function doProposeAdmin() {
    if (!newAdminAddr || !contracts) return;
    try {
      await writeContractAsync({ address: contracts.bridgeERC20, abi: BRIDGE_ERC20_ADMIN_ABI, functionName: 'proposeAdmin', args: [newAdminAddr as `0x${string}`] });
      showToast(`Admin proposal sent to ${newAdminAddr}`, 'success');
    } catch (e: any) { showToast(e.shortMessage || e.message, 'error'); }
  }

  async function doAcceptAdmin() {
    if (!contracts) return;
    try {
      await writeContractAsync({ address: contracts.bridgeERC20, abi: BRIDGE_ERC20_ADMIN_ABI, functionName: 'acceptAdmin' });
      showToast('Admin role accepted', 'success');
    } catch (e: any) { showToast(e.shortMessage || e.message, 'error'); }
  }

  async function doSetPeggedToken() {
    if (!srcToken || !wrappedToken || !contracts) return;
    try {
      await writeContractAsync({ address: contracts.bridgeERC20, abi: BRIDGE_ERC20_ADMIN_ABI, functionName: 'setPeggedToken', args: [srcToken as `0x${string}`, wrappedToken as `0x${string}`] });
      showToast('Pegged token mapping set', 'success');
    } catch (e: any) { showToast(e.shortMessage || e.message, 'error'); }
  }

  async function doPauseAll() {
    if (!contracts) return;
    try {
      await writeContractAsync({ address: contracts.router, abi: ROUTER_ADMIN_ABI, functionName: 'pause' });
      await writeContractAsync({ address: contracts.bridgeERC20, abi: BRIDGE_ERC20_ADMIN_ABI, functionName: 'pause' });
      await writeContractAsync({ address: contracts.liquidityManager, abi: LM_ADMIN_ABI, functionName: 'pause' });
      showToast('All contracts paused', 'success');
    } catch (e: any) { showToast(e.shortMessage || e.message, 'error'); }
  }

  async function doUnpauseAll() {
    if (!contracts) return;
    try {
      await writeContractAsync({ address: contracts.router, abi: ROUTER_ADMIN_ABI, functionName: 'unpause' });
      await writeContractAsync({ address: contracts.bridgeERC20, abi: BRIDGE_ERC20_ADMIN_ABI, functionName: 'unpause' });
      await writeContractAsync({ address: contracts.liquidityManager, abi: LM_ADMIN_ABI, functionName: 'unpause' });
      showToast('All contracts unpaused', 'success');
    } catch (e: any) { showToast(e.shortMessage || e.message, 'error'); }
  }

  return (
    <div className="space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} />}

      {/* Header */}
      <div>
        <h1 className="text-3xl font-sans font-bold">
          Admin <span className="bg-gradient-to-r from-accent to-purple-500 bg-clip-text text-transparent">Panel</span>
        </h1>
        <p className="text-sm text-gray-500 font-mono mt-1">
          Admin wallet: <span className="text-accent">{ADMIN_ADDR}</span>
        </p>
        {isConnected && (
          <p className="text-xs text-gray-500 mt-1">
            Connected to: <span className="text-white">{chainName}</span>
            {!isAdmin && <span className="text-red-400 ml-2">(Not admin wallet)</span>}
          </p>
        )}
      </div>

      {/* Admin Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

        {/* Relayer Management */}
        <div className="bg-card rounded-xl p-5 border border-gray-800">
          <h4 className="text-sm font-sans font-semibold text-white mb-4 flex items-center gap-2">
            <span className="text-purple-400">&#9670;</span> Relayer Management
          </h4>
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Current Relayer</label>
              <p className="text-xs font-mono text-accent break-all">{currentRelayer || 'Not set'}</p>
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Set Relayer Address</label>
              <input
                type="text" value={relayerAddr} onChange={e => setRelayerAddr(e.target.value)}
                placeholder="0x..."
                className="w-full bg-bg-dark border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-accent focus:outline-none"
              />
            </div>
            <button onClick={doSetRelayer} disabled={!isAdmin}
              className="w-full py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-accent to-cyan-400 text-bg-dark disabled:opacity-30">
              Set Relayer
            </button>
          </div>
        </div>

        {/* Fee Management */}
        <div className="bg-card rounded-xl p-5 border border-gray-800">
          <h4 className="text-sm font-sans font-semibold text-white mb-4 flex items-center gap-2">
            <span className="text-yellow-400">&#9679;</span> Fee Management
          </h4>
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">
                Default Bridge Fee (PPM) <span className="text-gray-600">current: {currentBridgeFee?.toString() || '—'}</span>
              </label>
              <input type="number" value={defaultFee} onChange={e => setDefaultFee(e.target.value)}
                placeholder="6000 = 0.6%"
                className="w-full bg-bg-dark border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-accent focus:outline-none"
              />
            </div>
            <button onClick={doSetDefaultFee} disabled={!isAdmin}
              className="w-full py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-yellow-500 to-orange-500 text-bg-dark disabled:opacity-30">
              Set Default Fee
            </button>

            <div className="pt-2 border-t border-gray-800">
              <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Token-Specific Fee</label>
              <input type="text" value={tokenFeeAddr} onChange={e => setTokenFeeAddr(e.target.value)}
                placeholder="Token address"
                className="w-full bg-bg-dark border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-accent focus:outline-none"
              />
              <input type="number" value={tokenFeeVal} onChange={e => setTokenFeeVal(e.target.value)}
                placeholder="PPM value"
                className="w-full bg-bg-dark border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-accent focus:outline-none mt-2"
              />
            </div>
            <button onClick={doSetTokenFee} disabled={!isAdmin}
              className="w-full py-2 rounded-lg text-sm font-semibold border border-gray-600 text-gray-300 hover:border-gray-400 disabled:opacity-30">
              Set Token Fee
            </button>

            <div className="pt-2 border-t border-gray-800">
              <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">
                Default Withdrawal Fee (PPM) <span className="text-gray-600">current: {currentWithdrawalFee?.toString() || '—'}</span>
              </label>
              <input type="number" value={withdrawalFee} onChange={e => setWithdrawalFee(e.target.value)}
                placeholder="3000 = 0.3%"
                className="w-full bg-bg-dark border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-accent focus:outline-none"
              />
            </div>
            <button onClick={doSetWithdrawalFee} disabled={!isAdmin}
              className="w-full py-2 rounded-lg text-sm font-semibold border border-gray-600 text-gray-300 hover:border-gray-400 disabled:opacity-30">
              Set Withdrawal Fee
            </button>
          </div>
        </div>

        {/* Admin Transfer */}
        <div className="bg-card rounded-xl p-5 border border-gray-800">
          <h4 className="text-sm font-sans font-semibold text-white mb-2 flex items-center gap-2">
            <span className="text-red-400">&#9670;</span> Admin Transfer
          </h4>
          <p className="text-[11px] text-gray-500 mb-4">Two-step transfer: propose then accept from new wallet.</p>
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Propose New Admin</label>
              <input type="text" value={newAdminAddr} onChange={e => setNewAdminAddr(e.target.value)}
                placeholder="0x..."
                className="w-full bg-bg-dark border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-accent focus:outline-none"
              />
            </div>
            <button onClick={doProposeAdmin} disabled={!isAdmin}
              className="w-full py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-red-500 to-pink-500 text-white disabled:opacity-30">
              Propose Admin
            </button>
            <button onClick={doAcceptAdmin}
              className="w-full py-2 rounded-lg text-sm font-semibold border border-gray-600 text-gray-300 hover:border-gray-400">
              Accept Admin (call from new wallet)
            </button>
          </div>
        </div>

        {/* Pegged Token Config */}
        <div className="bg-card rounded-xl p-5 border border-gray-800">
          <h4 className="text-sm font-sans font-semibold text-white mb-4 flex items-center gap-2">
            <span className="text-amber-400">&#9679;</span> Pegged Token Config
          </h4>
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Source Token Address</label>
              <input type="text" value={srcToken} onChange={e => setSrcToken(e.target.value)}
                placeholder="0x... (on source chain)"
                className="w-full bg-bg-dark border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Wrapped Token Address (on this chain)</label>
              <input type="text" value={wrappedToken} onChange={e => setWrappedToken(e.target.value)}
                placeholder="0x... (MintableERC20)"
                className="w-full bg-bg-dark border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-accent focus:outline-none"
              />
            </div>
            <button onClick={doSetPeggedToken} disabled={!isAdmin}
              className="w-full py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-amber-500 to-yellow-400 text-bg-dark disabled:opacity-30">
              Set Pegged Token
            </button>
          </div>
        </div>

        {/* Circuit Breaker */}
        <div className="bg-card rounded-xl p-5 border border-gray-800">
          <h4 className="text-sm font-sans font-semibold text-white mb-2 flex items-center gap-2">
            <span className="text-red-500">&#9632;</span> Circuit Breaker
          </h4>
          <p className="text-[11px] text-gray-500 mb-4">Pause all bridging operations in an emergency.</p>
          <div className="space-y-3">
            <button onClick={doPauseAll} disabled={!isAdmin}
              className="w-full py-3 rounded-lg text-sm font-semibold bg-red-500 text-white hover:bg-red-600 disabled:opacity-30">
              Pause All Contracts
            </button>
            <button onClick={doUnpauseAll} disabled={!isAdmin}
              className="w-full py-3 rounded-lg text-sm font-semibold border border-emerald-500 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-30">
              Unpause All Contracts
            </button>

            <div className="pt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Router status</span>
                <span className={routerPaused ? 'text-red-400' : 'text-emerald-400'}>
                  {routerPaused ? '● Paused' : '● Active'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">BridgeERC20 status</span>
                <span className={bridgePaused ? 'text-red-400' : 'text-emerald-400'}>
                  {bridgePaused ? '● Paused' : '● Active'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">LiquidityManager status</span>
                <span className={lmPaused ? 'text-red-400' : 'text-emerald-400'}>
                  {lmPaused ? '● Paused' : '● Active'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Deployed Contracts */}
        <div className="bg-card rounded-xl p-5 border border-gray-800">
          <h4 className="text-sm font-sans font-semibold text-white mb-4 flex items-center gap-2">
            <span className="text-blue-400">&#9670;</span> Deployed Contracts
          </h4>
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Router</label>
              <p className="text-[11px] font-mono text-gray-300 break-all">{contracts?.router || 'Not deployed'}</p>
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Bridge ERC20</label>
              <p className="text-[11px] font-mono text-gray-300 break-all">{contracts?.bridgeERC20 || 'Not deployed'}</p>
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Liquidity Manager</label>
              <p className="text-[11px] font-mono text-gray-300 break-all">{contracts?.liquidityManager || 'Not deployed'}</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
