'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount, useWriteContract, useSwitchChain } from 'wagmi';
import config from '@/config/bridge-config.json';
import { getRpc, rpcCall, isPlaceholderAddress } from '@/config/chainUtils';
import { formatUnits } from 'viem';

const BLAST_CHAIN_ID = 81457;

const BLAST_BRIDGE_ABI = [
  {
    inputs: [{ name: 'amount', type: 'uint256' }],
    name: 'claimBlastETHYield',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'claimBlastGas',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'claimBlastGasMax',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'amount', type: 'uint256' }],
    name: 'claimBlastWETHYield',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'amount', type: 'uint256' }],
    name: 'claimBlastUSDBYield',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

function fmt(wei: bigint, decimals = 18): string {
  const num = parseFloat(formatUnits(wei, decimals));
  if (num === 0) return '0';
  if (num < 0.0001) return num.toFixed(7);
  if (num < 1) return num.toFixed(6);
  return num.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}

function getBlastBridgeAddress(): `0x${string}` {
  const chain = config.chains['81457' as keyof typeof config.chains];
  return (chain?.contracts?.bridge || '0x0000000000000000000000000000000000000000') as `0x${string}`;
}

interface YieldData {
  ethYield: bigint;
  usdbYield: bigint;
  wethYield: bigint;
}

export function BlastYieldPanel() {
  const { address, chainId: walletChainId } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();

  const [data, setData] = useState<YieldData | null>(null);
  const [loading, setLoading] = useState(true);
  const [claimStatus, setClaimStatus] = useState<string>();
  const [claimingKey, setClaimingKey] = useState<string>();

  const isAdmin = address?.toLowerCase() === config.admin.toLowerCase();
  const bridgeAddress = getBlastBridgeAddress();
  const isPlaceholder = isPlaceholderAddress(bridgeAddress);

  const refresh = useCallback(async () => {
    if (isPlaceholder) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const rpc = getRpc(BLAST_CHAIN_ID);

    try {
      // getClaimableYields() returns (uint256 eth, uint256 usdb, uint256 weth)
      const selector = '0x3c40594d'; // getClaimableYields()
      const result = await rpcCall(rpc, 'eth_call', [{ to: bridgeAddress, data: selector }, 'latest']).catch(() => null);

      if (result && result.length >= 194) {
        const hex = result.slice(2);
        const ethYield = BigInt('0x' + hex.slice(0, 64));
        const usdbYield = BigInt('0x' + hex.slice(64, 128));
        const wethYield = BigInt('0x' + hex.slice(128, 192));
        setData({ ethYield, usdbYield, wethYield });
      } else {
        // Fallback: try individual selectors
        const [ethRes, wethRes, usdbRes] = await Promise.all([
          rpcCall(rpc, 'eth_call', [{ to: bridgeAddress, data: '0x3c40594d' }, 'latest']).catch(() => '0x0'),
          rpcCall(rpc, 'eth_call', [{ to: bridgeAddress, data: '0x54261341' }, 'latest']).catch(() => '0x0'),
          rpcCall(rpc, 'eth_call', [{ to: bridgeAddress, data: '0xf2adb344' }, 'latest']).catch(() => '0x0'),
        ]);

        const ethYield = ethRes && ethRes !== '0x' ? BigInt(ethRes) : 0n;
        const wethYield = wethRes && wethRes !== '0x' ? BigInt(wethRes) : 0n;
        const usdbYield = usdbRes && usdbRes !== '0x' ? BigInt(usdbRes) : 0n;
        setData({ ethYield, usdbYield, wethYield });
      }
    } catch (err) {
      console.error('Failed to fetch yield data:', err);
    }

    setLoading(false);
  }, [bridgeAddress, isPlaceholder]);

  useEffect(() => { refresh(); }, [refresh]);

  async function claim(key: string, functionName: string, args?: readonly [bigint]) {
    if (!address) return;

    try {
      setClaimingKey(key);

      if (walletChainId !== BLAST_CHAIN_ID) {
        setClaimStatus('Switching to Blast...');
        await switchChainAsync({ chainId: BLAST_CHAIN_ID });
      }

      setClaimStatus('Claiming...');
      await writeContractAsync({
        address: bridgeAddress,
        abi: BLAST_BRIDGE_ABI,
        functionName: functionName as any,
        args: args as any,
      });

      setClaimStatus('Claimed!');
      setTimeout(() => { setClaimingKey(undefined); setClaimStatus(undefined); refresh(); }, 2000);
    } catch (err: any) {
      const msg = err.shortMessage || err.message;
      setClaimStatus(msg?.includes('User rejected') ? 'Cancelled' : `Error: ${msg}`);
      setTimeout(() => { setClaimingKey(undefined); setClaimStatus(undefined); }, 3000);
    }
  }

  if (isPlaceholder) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-sans font-bold text-white mb-2">Blast Yield Dashboard</h1>
          <p className="text-gray-400 text-sm">Bridge contract not yet deployed on Blast</p>
        </div>
        <div className="bg-card rounded-2xl p-8 border border-gray-800 text-center text-gray-500">
          Contract addresses are placeholders. Deploy the Blast bridge contract first,
          then update bridge-config.json with the deployed addresses.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-sans font-bold text-white mb-2">Blast Yield Dashboard</h1>
        <p className="text-gray-400 text-sm">Claim ETH yield, token rebasing yield, and gas refunds</p>
      </div>

      {!isAdmin && (
        <div className="bg-red-900/20 border border-red-800 rounded-2xl p-4 text-center text-red-400 text-sm">
          Admin access required. Connect with the admin wallet to claim yield.
        </div>
      )}

      <div className="bg-card rounded-2xl p-5 border border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-sans font-semibold text-gray-300">Claimable Yield</h2>
          <button
            onClick={refresh}
            disabled={loading}
            className="text-xs px-3 py-1 rounded-lg bg-[#FCFC03]/10 text-[#FCFC03] border border-[#FCFC03]/30 hover:bg-[#FCFC03]/20 transition-colors disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8">
            <div className="inline-block w-6 h-6 border-2 border-[#FCFC03] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : data ? (
          <div className="space-y-4">
            {/* ETH Yield */}
            <YieldRow
              label="ETH Yield"
              amount={fmt(data.ethYield)}
              symbol="ETH"
              claimKey="eth"
              claimingKey={claimingKey}
              claimStatus={claimStatus}
              disabled={!isAdmin || data.ethYield === 0n}
              onClaim={() => claim('eth', 'claimBlastETHYield', [data.ethYield])}
            />

            {/* WETH Yield */}
            <YieldRow
              label="WETH Rebasing Yield"
              amount={fmt(data.wethYield)}
              symbol="WETH"
              claimKey="weth"
              claimingKey={claimingKey}
              claimStatus={claimStatus}
              disabled={!isAdmin || data.wethYield === 0n}
              onClaim={() => claim('weth', 'claimBlastWETHYield', [data.wethYield])}
            />

            {/* USDB Yield */}
            <YieldRow
              label="USDB Rebasing Yield"
              amount={fmt(data.usdbYield)}
              symbol="USDB"
              claimKey="usdb"
              claimingKey={claimingKey}
              claimStatus={claimStatus}
              disabled={!isAdmin || data.usdbYield === 0n}
              onClaim={() => claim('usdb', 'claimBlastUSDBYield', [data.usdbYield])}
            />

            {/* Gas Refund */}
            <div className="border-t border-gray-800 pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white font-medium text-sm">Gas Fee Refund</p>
                  <p className="text-gray-500 text-xs mt-0.5">Claim accumulated gas refunds from Blast</p>
                </div>
                <div className="flex items-center gap-3">
                  {claimingKey === 'gas' ? (
                    <span className="text-xs text-yellow-400 min-w-[80px] text-right">{claimStatus}</span>
                  ) : (
                    <button
                      onClick={() => claim('gas', 'claimBlastGasMax')}
                      disabled={!isAdmin}
                      className="px-3 py-1 rounded text-xs bg-[#FCFC03]/10 text-[#FCFC03] border border-[#FCFC03]/30 hover:bg-[#FCFC03]/20 transition-colors disabled:opacity-30 whitespace-nowrap"
                    >
                      Claim Gas
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-gray-500 text-sm text-center py-4">Failed to load yield data</p>
        )}
      </div>

      {/* Contract Info */}
      <div className="bg-card rounded-2xl p-5 border border-gray-800">
        <h2 className="text-sm font-sans font-semibold text-gray-300 mb-3">Contract Info</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Bridge Contract</span>
            <a
              href={`https://blastscan.io/address/${bridgeAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#FCFC03] hover:underline font-mono text-xs"
            >
              {bridgeAddress}
            </a>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Admin</span>
            <span className="text-gray-300 font-mono text-xs">{config.admin}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Chain</span>
            <span className="text-gray-300">Blast (81457)</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function YieldRow({
  label,
  amount,
  symbol,
  claimKey,
  claimingKey,
  claimStatus,
  disabled,
  onClaim,
}: {
  label: string;
  amount: string;
  symbol: string;
  claimKey: string;
  claimingKey?: string;
  claimStatus?: string;
  disabled: boolean;
  onClaim: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <p className="text-white font-medium text-sm">{label}</p>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[#FCFC03] font-mono text-sm">{amount} {symbol}</span>
        {claimingKey === claimKey ? (
          <span className="text-xs text-yellow-400 min-w-[80px] text-right">{claimStatus}</span>
        ) : (
          <button
            onClick={onClaim}
            disabled={disabled}
            className="px-3 py-1 rounded text-xs bg-[#FCFC03]/10 text-[#FCFC03] border border-[#FCFC03]/30 hover:bg-[#FCFC03]/20 transition-colors disabled:opacity-30 whitespace-nowrap"
          >
            Claim
          </button>
        )}
      </div>
    </div>
  );
}
