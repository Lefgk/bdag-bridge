'use client';

import { useState, useEffect, useMemo } from 'react';
import config from '@/config/bridge-config.json';
import { isPlaceholderAddress, getRpc, rpcCall } from '@/config/chainUtils';

// Minimal ERC20 selectors for multicall
const NAME_SELECTOR = '0x06fdde03';       // name()
const SYMBOL_SELECTOR = '0x95d89b41';     // symbol()
const DECIMALS_SELECTOR = '0x313ce567';   // decimals()

// Multicall3 deployed on most EVM chains at this address
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

interface TokenInfo {
  configSymbol: string;
  configName: string;
  icon: string;
  address: string;
  chainId: number;
  bdagAddress: string;
  bdagDecimals: number;
  sourceDecimals: number;
  // on-chain fetched
  onChainName?: string;
  onChainSymbol?: string;
  onChainDecimals?: number;
}

interface ChainMeta {
  name: string;
  label: string;
  icon: string;
  explorer: string;
}

const chains = config.chains as Record<string, ChainMeta & { rpc: string[] }>;

function decodeString(hex: string): string {
  if (!hex || hex === '0x' || hex.length < 66) return '';
  try {
    // ABI-encoded string: offset(32) + length(32) + data
    const offset = parseInt(hex.slice(2, 66), 16) * 2;
    const lenHex = hex.slice(2 + offset, 2 + offset + 64);
    const len = parseInt(lenHex, 16);
    const dataHex = hex.slice(2 + offset + 64, 2 + offset + 64 + len * 2);
    const bytes = [];
    for (let i = 0; i < dataHex.length; i += 2) {
      bytes.push(parseInt(dataHex.slice(i, i + 2), 16));
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch {
    // Some tokens return non-standard bytes32 string
    try {
      const stripped = hex.replace(/0+$/, '');
      const bytes = [];
      for (let i = 2; i < stripped.length; i += 2) {
        const b = parseInt(stripped.slice(i, i + 2), 16);
        if (b === 0) break;
        bytes.push(b);
      }
      return new TextDecoder().decode(new Uint8Array(bytes));
    } catch {
      return '';
    }
  }
}

function decodeUint(hex: string): number {
  if (!hex || hex === '0x') return 0;
  return parseInt(hex.slice(2, 66), 16);
}

// Build multicall3 aggregate3 calldata
function buildMulticall3Data(calls: { target: string; callData: string }[]): string {
  // aggregate3((address target, bool allowFailure, bytes callData)[])
  // selector: 0x82ad56cb
  const selector = '0x82ad56cb';

  // Encode the array of Call3 structs
  // Each struct: (address, bool, bytes)
  const abiEncode = (calls: { target: string; callData: string }[]) => {
    // offset to array data (32 bytes)
    let result = '0000000000000000000000000000000000000000000000000000000000000020';
    // array length
    result += calls.length.toString(16).padStart(64, '0');
    // For each element, we need an offset pointer, then the data
    // Each Call3 is a tuple, so we need to handle dynamic encoding
    const headSize = calls.length * 32;
    const tails: string[] = [];
    let tailOffset = headSize;

    for (const call of calls) {
      result += tailOffset.toString(16).padStart(64, '0');
      // encode tuple: address (32) + bool (32) + bytes offset (32) + bytes length (32) + bytes data (padded)
      const callDataBytes = call.callData.startsWith('0x') ? call.callData.slice(2) : call.callData;
      const callDataLen = callDataBytes.length / 2;
      const callDataPadded = callDataBytes.padEnd(Math.ceil(callDataBytes.length / 64) * 64, '0');

      let tail = '';
      tail += call.target.slice(2).toLowerCase().padStart(64, '0'); // address
      tail += '0000000000000000000000000000000000000000000000000000000000000001'; // allowFailure = true
      tail += '0000000000000000000000000000000000000000000000000000000000000060'; // bytes offset
      tail += callDataLen.toString(16).padStart(64, '0'); // bytes length
      tail += callDataPadded; // bytes data

      tails.push(tail);
      tailOffset += tail.length / 2;
    }

    for (const tail of tails) {
      result += tail;
    }

    return result;
  };

  return selector + abiEncode(calls);
}

// Decode multicall3 aggregate3 return
function decodeMulticall3Result(hex: string): { success: boolean; data: string }[] {
  if (!hex || hex === '0x') return [];
  try {
    const data = hex.startsWith('0x') ? hex.slice(2) : hex;
    // Return: (bool success, bytes returnData)[]
    // offset to array
    const arrayOffset = parseInt(data.slice(0, 64), 16) * 2;
    const arrayLen = parseInt(data.slice(arrayOffset, arrayOffset + 64), 16);
    const results: { success: boolean; data: string }[] = [];

    for (let i = 0; i < arrayLen; i++) {
      const elemOffsetPos = arrayOffset + 64 + i * 64;
      const elemOffset = parseInt(data.slice(elemOffsetPos, elemOffsetPos + 64), 16) * 2 + arrayOffset + 64;
      const success = parseInt(data.slice(elemOffset, elemOffset + 64), 16) !== 0;
      const bytesOffset = parseInt(data.slice(elemOffset + 64, elemOffset + 128), 16) * 2;
      const bytesLen = parseInt(data.slice(elemOffset + bytesOffset + 64, elemOffset + bytesOffset + 128), 16);
      const bytesData = data.slice(elemOffset + bytesOffset + 128, elemOffset + bytesOffset + 128 + bytesLen * 2);
      results.push({ success, data: '0x' + bytesData });
    }
    return results;
  } catch {
    return [];
  }
}

async function fetchTokensForChain(chainId: number, tokens: TokenInfo[]): Promise<TokenInfo[]> {
  if (tokens.length === 0) return tokens;
  const rpc = getRpc(chainId);
  if (!rpc) return tokens;

  // Build multicall: 3 calls per token (name, symbol, decimals)
  const calls = tokens.flatMap(t => [
    { target: t.address, callData: NAME_SELECTOR },
    { target: t.address, callData: SYMBOL_SELECTOR },
    { target: t.address, callData: DECIMALS_SELECTOR },
  ]);

  try {
    const calldata = buildMulticall3Data(calls);
    const result = await rpcCall(rpc, 'eth_call', [{ to: MULTICALL3, data: calldata }, 'latest']);
    const decoded = decodeMulticall3Result(result);

    return tokens.map((t, i) => {
      const nameResult = decoded[i * 3];
      const symbolResult = decoded[i * 3 + 1];
      const decimalsResult = decoded[i * 3 + 2];

      return {
        ...t,
        onChainName: nameResult?.success ? decodeString(nameResult.data) : undefined,
        onChainSymbol: symbolResult?.success ? decodeString(symbolResult.data) : undefined,
        onChainDecimals: decimalsResult?.success ? decodeUint(decimalsResult.data) : undefined,
      };
    });
  } catch (err) {
    console.warn(`Multicall failed for chain ${chainId}:`, err);
    return tokens;
  }
}

export default function TokensPage() {
  const [onChainData, setOnChainData] = useState<Record<string, TokenInfo[]>>({});
  const [loading, setLoading] = useState(true);
  const [selectedChain, setSelectedChain] = useState<string>('all');

  // Build token list grouped by source chain
  const tokensByChain = useMemo(() => {
    const grouped: Record<string, TokenInfo[]> = {};

    for (const token of config.tokens) {
      const chainIds = Object.keys(token.addresses).map(Number);
      // Find the source chain (non-BDAG chain)
      const sourceChainId = chainIds.find(id => id !== 1404);
      const bdagInfo = token.addresses['1404' as keyof typeof token.addresses] as any;

      if (sourceChainId && bdagInfo) {
        const sourceInfo = token.addresses[String(sourceChainId) as keyof typeof token.addresses] as any;
        if (!sourceInfo || isPlaceholderAddress(sourceInfo.address)) continue;

        const key = String(sourceChainId);
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push({
          configSymbol: token.symbol,
          configName: token.name,
          icon: token.icon,
          address: sourceInfo.address,
          chainId: sourceChainId,
          bdagAddress: bdagInfo.address,
          bdagDecimals: bdagInfo.decimals,
          sourceDecimals: sourceInfo.decimals,
        });
      } else if (chainIds.length === 1 && chainIds[0] === 1404 && bdagInfo) {
        // BDAG-only token (like wBonie)
        if (isPlaceholderAddress(bdagInfo.address)) continue;
        const key = '1404';
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push({
          configSymbol: token.symbol,
          configName: token.name,
          icon: token.icon,
          address: bdagInfo.address,
          chainId: 1404,
          bdagAddress: bdagInfo.address,
          bdagDecimals: bdagInfo.decimals,
          sourceDecimals: bdagInfo.decimals,
        });
      }
    }
    return grouped;
  }, []);

  // Fetch on-chain data via multicall per chain
  useEffect(() => {
    async function fetchAll() {
      setLoading(true);
      const results: Record<string, TokenInfo[]> = {};
      const promises = Object.entries(tokensByChain).map(async ([chainId, tokens]) => {
        const enriched = await fetchTokensForChain(Number(chainId), tokens);
        results[chainId] = enriched;
      });
      await Promise.all(promises);
      setOnChainData(results);
      setLoading(false);
    }
    fetchAll();
  }, [tokensByChain]);

  const chainIds = Object.keys(tokensByChain).sort((a, b) => {
    // Put BDAG last
    if (a === '1404') return 1;
    if (b === '1404') return -1;
    return Number(a) - Number(b);
  });

  const totalTokens = Object.values(tokensByChain).reduce((sum, arr) => sum + arr.length, 0);

  const displayChains = selectedChain === 'all' ? chainIds : [selectedChain];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-sans font-bold">
          Supported <span className="bg-gradient-to-r from-accent to-purple-500 bg-clip-text text-transparent">Tokens</span>
        </h1>
        <p className="text-sm text-gray-500 font-mono mt-1">
          {totalTokens} bridgeable tokens across {chainIds.length} chains
        </p>
      </div>

      {/* Chain Filter */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSelectedChain('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
            selectedChain === 'all'
              ? 'bg-accent/20 text-accent border border-accent/30'
              : 'bg-card border border-gray-800 text-gray-400 hover:text-gray-200'
          }`}
        >
          All Chains ({totalTokens})
        </button>
        {chainIds.map(cid => {
          const chain = chains[cid];
          const count = tokensByChain[cid]?.length || 0;
          return (
            <button
              key={cid}
              onClick={() => setSelectedChain(cid)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                selectedChain === cid
                  ? 'bg-accent/20 text-accent border border-accent/30'
                  : 'bg-card border border-gray-800 text-gray-400 hover:text-gray-200'
              }`}
            >
              {chain?.icon && (
                <img src={chain.icon} alt="" className="w-4 h-4 rounded-full" />
              )}
              {chain?.label || `Chain ${cid}`} ({count})
            </button>
          );
        })}
      </div>

      {/* Loading */}
      {loading && (
        <div className="text-center py-8">
          <div className="inline-block w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          <p className="text-sm text-gray-500 mt-2 font-mono">Fetching on-chain token data...</p>
        </div>
      )}

      {/* Token Tables per Chain */}
      {displayChains.map(cid => {
        const chain = chains[cid];
        const tokens = onChainData[cid] || tokensByChain[cid] || [];
        if (tokens.length === 0) return null;

        return (
          <div key={cid} className="bg-card rounded-xl border border-gray-800 overflow-hidden">
            {/* Chain Header */}
            <div className="px-5 py-3 border-b border-gray-800 flex items-center gap-3">
              {chain?.icon && (
                <img src={chain.icon} alt="" className="w-6 h-6 rounded-full" />
              )}
              <div>
                <h3 className="text-sm font-sans font-semibold text-white">
                  {chain?.name || `Chain ${cid}`}
                </h3>
                <p className="text-[10px] text-gray-500 font-mono">
                  Chain ID: {cid} &middot; {tokens.length} token{tokens.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>

            {/* Token List */}
            <div className="divide-y divide-gray-800/50">
              <div className="grid grid-cols-12 gap-2 px-5 py-2 text-[10px] text-gray-600 uppercase tracking-wider font-mono">
                <div className="col-span-3">Token</div>
                <div className="col-span-4">Source Address</div>
                <div className="col-span-4">BDAG Wrapped Address</div>
                <div className="col-span-1 text-right">Decimals</div>
              </div>

              {tokens.map((t, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 px-5 py-3 items-center hover:bg-white/[0.02] transition-colors">
                  {/* Token Info */}
                  <div className="col-span-3 flex items-center gap-2.5">
                    <img
                      src={t.icon}
                      alt={t.configSymbol}
                      className="w-7 h-7 rounded-full bg-gray-800"
                      onError={(e) => { (e.target as HTMLImageElement).src = 'https://bdagscan.com/favicon.png'; }}
                    />
                    <div>
                      <span className="text-sm font-semibold text-white">
                        {t.onChainSymbol || t.configSymbol}
                      </span>
                      <p className="text-[10px] text-gray-500 leading-tight">
                        {t.onChainName || t.configName}
                      </p>
                    </div>
                  </div>

                  {/* Source Address */}
                  <div className="col-span-4">
                    <a
                      href={`${chain?.explorer || '#'}/address/${t.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-mono text-gray-400 hover:text-accent break-all transition-colors"
                    >
                      {t.address}
                    </a>
                    {t.onChainDecimals !== undefined && t.onChainDecimals !== t.sourceDecimals && (
                      <span className="text-[9px] text-yellow-500 ml-1" title="On-chain decimals differ from config">
                        (on-chain: {t.onChainDecimals})
                      </span>
                    )}
                  </div>

                  {/* BDAG Address */}
                  <div className="col-span-4">
                    {t.chainId === 1404 ? (
                      <span className="text-[11px] font-mono text-gray-600">Native</span>
                    ) : (
                      <a
                        href={`https://bdagscan.com/address/${t.bdagAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] font-mono text-gray-400 hover:text-accent break-all transition-colors"
                      >
                        {t.bdagAddress}
                      </a>
                    )}
                  </div>

                  {/* Decimals */}
                  <div className="col-span-1 text-right">
                    <span className="text-xs font-mono text-gray-500">
                      {t.onChainDecimals ?? t.sourceDecimals}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
