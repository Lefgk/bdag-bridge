'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { useBridgeHistory, lookupDepositByTxHash, BridgeTx } from '@/hooks/useBridgeHistory';
import { chainLabel, explorerTxUrl, RELAYER_API } from '@/config/chainUtils';

function directionBadge(sourceChainId: number, targetChainId: number) {
  const label = `${chainLabel(sourceChainId)} → ${chainLabel(targetChainId)}`;
  const isBscToBdag = sourceChainId === 56;
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold whitespace-nowrap ${
      isBscToBdag
        ? 'bg-[#F3BA2F]/15 text-[#F3BA2F] border border-[#F3BA2F]/30'
        : 'bg-accent/15 text-accent border border-accent/30'
    }`}>
      {label}
    </span>
  );
}

function truncateHash(hash: string): string {
  if (hash.length <= 14) return hash;
  return hash.slice(0, 8) + '...' + hash.slice(-6);
}

function formatDate(timestamp?: number): string {
  if (!timestamp) return '—';
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatusBadge({ released }: { released: boolean }) {
  if (released) {
    return (
      <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-green-500/15 text-green-400 border border-green-500/30">
        Released
      </span>
    );
  }
  return (
    <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 animate-pulse">
      Pending
    </span>
  );
}

interface LookupResult {
  sourceChainId: number;
  targetChainId: number;
  depositNumber: bigint;
  tokenSymbol: string;
  amount: string;
  receiver: string;
  released: boolean;
  releaseTxHash?: string;
}

export function TransactionHistory() {
  const { isConnected } = useAccount();
  const { txs, loading, error, refetch } = useBridgeHistory();

  const [filterUnreceived, setFilterUnreceived] = useState(false);
  const [lookupHash, setLookupHash] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [lookupError, setLookupError] = useState<string>();
  const [lookupDone, setLookupDone] = useState(false);

  const handleLookup = async () => {
    const hash = lookupHash.trim();
    if (!hash || !hash.startsWith('0x')) return;
    setLookupLoading(true);
    setLookupError(undefined);
    setLookupResult(null);
    setLookupDone(false);

    try {
      const result = await lookupDepositByTxHash(hash);
      if (result) {
        setLookupResult(result);
      } else {
        setLookupError('No bridge deposit found in this transaction.');
      }
      setLookupDone(true);
    } catch (err: any) {
      setLookupError(err.message || 'Lookup failed');
      setLookupDone(true);
    } finally {
      setLookupLoading(false);
    }
  };

  const [forceLoading, setForceLoading] = useState<string | null>(null);
  const [forceResult, setForceResult] = useState<string>();

  const handleForceCheck = async (txHash: string) => {
    setForceLoading(txHash);
    setForceResult(undefined);
    try {
      const res = await fetch(`${RELAYER_API}/check-tx/${txHash}`);
      const data = await res.json();
      if (data.status === 'released') {
        setForceResult(`Released! Tx: ${data.releaseTxHash}`);
        refetch();
      } else if (data.status === 'already_processed') {
        setForceResult(`Already processed. Tx: ${data.releaseTxHash}`);
        refetch();
      } else {
        setForceResult(data.error || 'Unknown result');
      }
    } catch (err: any) {
      setForceResult(`Error: ${err.message}`);
    } finally {
      setForceLoading(null);
    }
  };

  const handleForceAll = async () => {
    setForceLoading('all');
    setForceResult(undefined);
    try {
      const res = await fetch(`${RELAYER_API}/retry-pending`);
      const data = await res.json();
      if (data.count === 0) {
        setForceResult('No pending deposits found');
      } else {
        // Force-check each pending deposit's tx
        let released = 0;
        for (const item of data.pending) {
          // Also try our own wallet's pending txs
          const matching = txs.find(tx => !tx.released && `${tx.sourceChainId}_${tx.depositNumber}` === item.key);
          if (matching) {
            try {
              const r = await fetch(`${RELAYER_API}/check-tx/${matching.depositTxHash}`);
              const d = await r.json();
              if (d.status === 'released' || d.status === 'already_processed') released++;
            } catch { /* skip */ }
          }
        }
        setForceResult(`Found ${data.count} pending globally, processed ${released} of yours`);
      }
    } catch (err: any) {
      setForceResult(`Error: ${err.message}`);
    }
    setForceLoading(null);
    refetch();
  };

  const filteredTxs = filterUnreceived ? txs.filter(tx => !tx.released) : txs;

  if (!isConnected) {
    return (
      <div className="space-y-6 max-w-6xl mx-auto">
        <div className="text-center">
          <h1 className="text-3xl font-sans font-bold text-white mb-2">Transactions</h1>
          <p className="text-gray-400 text-sm">View your bridge transaction history</p>
        </div>
        <div className="bg-card rounded-2xl p-8 border border-gray-800 text-center">
          <p className="text-gray-400">Connect your wallet to view transactions.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="text-center">
        <h1 className="text-3xl font-sans font-bold text-white mb-2">Transactions</h1>
        <p className="text-gray-400 text-sm">View your bridge transaction history</p>
      </div>

      {/* Status Lookup */}
      <div className="bg-card rounded-2xl p-5 border border-gray-800">
        <h2 className="text-sm font-sans font-semibold text-gray-300 mb-3">Lookup Deposit Status</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={lookupHash}
            onChange={e => { setLookupHash(e.target.value); setLookupDone(false); }}
            placeholder="Paste deposit tx hash (0x...)"
            className="flex-1 bg-bg-dark border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:border-accent focus:outline-none"
          />
          <button
            onClick={handleLookup}
            disabled={lookupLoading || !lookupHash.trim()}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-bg-dark hover:bg-accent-dim disabled:opacity-40 transition-colors"
          >
            {lookupLoading ? 'Checking...' : 'Check'}
          </button>
        </div>

        {lookupDone && lookupResult && (
          <div className="mt-3 p-3 rounded-lg bg-bg-dark border border-gray-700 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Direction</span>
              {directionBadge(lookupResult.sourceChainId, lookupResult.targetChainId)}
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Token</span>
              <span className="text-white">{lookupResult.tokenSymbol}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Amount</span>
              <span className="text-white">{parseFloat(lookupResult.amount).toFixed(4)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Deposit #</span>
              <span className="text-white">{lookupResult.depositNumber.toString()}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Status</span>
              <StatusBadge released={lookupResult.released} />
            </div>
            {lookupResult.releaseTxHash && (
              <div className="flex justify-between">
                <span className="text-gray-400">Release Tx</span>
                <a
                  href={explorerTxUrl(lookupResult.releaseTxHash, lookupResult.targetChainId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:text-accent-dim text-xs break-all"
                >
                  {truncateHash(lookupResult.releaseTxHash)}
                </a>
              </div>
            )}
            {!lookupResult.released && (
              <button
                onClick={() => handleForceCheck(lookupHash.trim())}
                disabled={forceLoading === lookupHash.trim()}
                className="mt-2 w-full py-2 rounded-lg text-sm font-semibold bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/30 disabled:opacity-40 transition-colors"
              >
                {forceLoading === lookupHash.trim() ? 'Releasing...' : 'Force Release via Relayer'}
              </button>
            )}
          </div>
        )}
        {lookupDone && lookupError && (
          <p className="mt-2 text-sm text-red-400">{lookupError}</p>
        )}
        {forceResult && (
          <p className="mt-2 text-sm text-accent">{forceResult}</p>
        )}
      </div>

      {/* Transaction Table */}
      <div className="bg-card rounded-2xl p-5 border border-gray-800">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-sm font-sans font-semibold text-gray-300">History</h2>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={filterUnreceived}
                onChange={e => setFilterUnreceived(e.target.checked)}
                className="accent-accent"
              />
              Show only unreceived
            </label>
            {txs.some(tx => !tx.released) && (
              <button
                onClick={handleForceAll}
                disabled={forceLoading === 'all'}
                className="text-xs px-3 py-1 rounded-lg bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/20 transition-colors disabled:opacity-40"
              >
                {forceLoading === 'all' ? 'Processing...' : 'Force All Pending'}
              </button>
            )}
            <button
              onClick={refetch}
              disabled={loading}
              className="text-xs px-3 py-1 rounded-lg bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 transition-colors disabled:opacity-40"
            >
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-3 p-2 rounded bg-red-500/10 border border-red-500/20">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        {loading && txs.length === 0 ? (
          <div className="text-center py-8">
            <div className="inline-block w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-400 text-sm mt-2">Loading transactions...</p>
          </div>
        ) : filteredTxs.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500 text-sm">
              {filterUnreceived ? 'No pending transactions.' : 'No bridge transactions found.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs border-b border-gray-800">
                  <th className="text-left pb-2 pr-3 font-medium">Date</th>
                  <th className="text-left pb-2 pr-3 font-medium">Direction</th>
                  <th className="text-left pb-2 pr-3 font-medium">Sending Tx</th>
                  <th className="text-left pb-2 pr-3 font-medium">Receiving Tx</th>
                  <th className="text-right pb-2 pr-3 font-medium">Amount</th>
                  <th className="text-right pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredTxs.map((tx, i) => (
                  <tr key={`${tx.depositTxHash}-${i}`} className="border-b border-gray-800/50 last:border-0">
                    <td className="py-2.5 pr-3 text-gray-400 whitespace-nowrap">{formatDate(tx.timestamp)}</td>
                    <td className="py-2.5 pr-3">{directionBadge(tx.sourceChainId, tx.targetChainId)}</td>
                    <td className="py-2.5 pr-3">
                      <a
                        href={explorerTxUrl(tx.depositTxHash, tx.sourceChainId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:text-accent-dim text-xs"
                      >
                        {truncateHash(tx.depositTxHash)}
                      </a>
                    </td>
                    <td className="py-2.5 pr-3">
                      {tx.releaseTxHash ? (
                        <a
                          href={explorerTxUrl(tx.releaseTxHash, tx.targetChainId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent hover:text-accent-dim text-xs"
                        >
                          {truncateHash(tx.releaseTxHash)}
                        </a>
                      ) : (
                        <span className="text-gray-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-white whitespace-nowrap">
                      {parseFloat(tx.amount).toFixed(4)} {tx.tokenSymbol}
                    </td>
                    <td className="py-2.5 text-right">
                      <StatusBadge released={tx.released} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
