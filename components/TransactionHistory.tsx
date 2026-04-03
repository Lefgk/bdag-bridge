'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { useBridgeHistory, lookupDepositByTxHash, BridgeTx } from '@/hooks/useBridgeHistory';
import { chainLabel, explorerTxUrl } from '@/config/chainUtils';

function directionBadge(sourceChainId: number, destChainId: number) {
  const label = `${chainLabel(sourceChainId)} → ${chainLabel(destChainId)}`;
  return (
    <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold whitespace-nowrap bg-accent/15 text-accent border border-accent/30">
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

function StatusBadge({ delivered, reverted }: { delivered: boolean; reverted?: boolean }) {
  if (reverted) {
    return (
      <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-red-500/15 text-red-400 border border-red-500/30">
        Reverted
      </span>
    );
  }
  if (delivered) {
    return (
      <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-green-500/15 text-green-400 border border-green-500/30">
        Delivered
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
  destChainId: number;
  depositNumber: string;
  tokenSymbol: string;
  amount: string;
  receiver: string;
  delivered: boolean;
}

export function TransactionHistory() {
  const { isConnected } = useAccount();
  const { txs, loading, error, refetch } = useBridgeHistory();

  const [filterPending, setFilterPending] = useState(false);
  const [lookupHash, setLookupHash] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [lookupError, setLookupError] = useState<string>();
  const [lookupDone, setLookupDone] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryResult, setRetryResult] = useState<string>();
  const [retryingTx, setRetryingTx] = useState<string>();

  const handleRetryAll = async () => {
    setRetrying(true);
    setRetryResult(undefined);
    try {
      const res = await fetch('/api/relayer/retry-pending', { signal: AbortSignal.timeout(120000) });
      const data = await res.json();
      if (data.released > 0) {
        setRetryResult(`Released ${data.released} of ${data.count} pending`);
        refetch();
      } else if (data.count === 0) {
        setRetryResult('No pending deposits found');
      } else {
        setRetryResult(`${data.count} pending, 0 released — check relayer logs`);
      }
    } catch (err: any) {
      setRetryResult(err.message || 'Retry failed');
    } finally {
      setRetrying(false);
    }
  };

  const handleRetryTx = async (txHash: string) => {
    setRetryingTx(txHash);
    try {
      const res = await fetch(`/api/relayer/check-tx/${txHash}`, { signal: AbortSignal.timeout(120000) });
      const data = await res.json();
      if (data.releaseTxHash && data.releaseTxHash.startsWith('0x')) {
        refetch();
      }
    } catch { /* ignore */ }
    finally { setRetryingTx(undefined); }
  };

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

  const filteredTxs = filterPending ? txs.filter(tx => !tx.delivered) : txs;

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
              {directionBadge(lookupResult.sourceChainId, lookupResult.destChainId)}
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
              <span className="text-white font-mono">{lookupResult.depositNumber}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Status</span>
              <StatusBadge delivered={lookupResult.delivered} />
            </div>
          </div>
        )}
        {lookupDone && lookupError && (
          <p className="mt-2 text-sm text-red-400">{lookupError}</p>
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
                checked={filterPending}
                onChange={e => setFilterPending(e.target.checked)}
                className="accent-accent"
              />
              Show only pending
            </label>
            <button
              onClick={handleRetryAll}
              disabled={retrying}
              className="text-xs px-3 py-1 rounded-lg bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/20 transition-colors disabled:opacity-40"
            >
              {retrying ? 'Retrying...' : 'Retry Pending'}
            </button>
            <button
              onClick={refetch}
              disabled={loading}
              className="text-xs px-3 py-1 rounded-lg bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 transition-colors disabled:opacity-40"
            >
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
        </div>

        {retryResult && (
          <div className="mb-3 p-2 rounded bg-yellow-500/10 border border-yellow-500/20">
            <p className="text-xs text-yellow-400">{retryResult}</p>
          </div>
        )}

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
              {filterPending ? 'No pending transactions.' : 'No bridge transactions found.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs border-b border-gray-800">
                  <th className="text-left pb-2 pr-3 font-medium">Date</th>
                  <th className="text-left pb-2 pr-3 font-medium">Direction</th>
                  <th className="text-left pb-2 pr-3 font-medium">Deposit Tx</th>
                  <th className="text-left pb-2 pr-3 font-medium">Release Tx</th>
                  <th className="text-right pb-2 pr-3 font-medium">Amount</th>
                  <th className="text-right pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredTxs.map((tx, i) => (
                  <tr key={`${tx.txHash}-${i}`} className="border-b border-gray-800/50 last:border-0">
                    <td className="py-2.5 pr-3 text-gray-400 whitespace-nowrap">{formatDate(tx.timestamp)}</td>
                    <td className="py-2.5 pr-3">{directionBadge(tx.sourceChainId, tx.destChainId)}</td>
                    <td className="py-2.5 pr-3">
                      {tx.txHash ? (
                        <a
                          href={explorerTxUrl(tx.txHash, tx.sourceChainId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent hover:text-accent-dim text-xs"
                        >
                          {truncateHash(tx.txHash)}
                        </a>
                      ) : (
                        <span className="text-gray-500 text-xs">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      {tx.releaseTxHash ? (
                        <a
                          href={explorerTxUrl(tx.releaseTxHash, tx.destChainId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`hover:text-accent-dim text-xs ${tx.reverted ? 'text-red-400' : 'text-accent'}`}
                        >
                          {tx.reverted ? 'Reverted' : truncateHash(tx.releaseTxHash)}
                        </a>
                      ) : (
                        <span className="text-gray-500 text-xs">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-white whitespace-nowrap">
                      {isNaN(parseFloat(tx.amount)) ? '—' : `${parseFloat(tx.amount).toFixed(4)} ${tx.tokenSymbol}`}
                    </td>
                    <td className="py-2.5 text-right">
                      <StatusBadge delivered={tx.delivered} reverted={tx.reverted} />
                      {!tx.delivered && !tx.reverted && tx.txHash && (
                        <button
                          onClick={() => handleRetryTx(tx.txHash)}
                          disabled={retryingTx === tx.txHash}
                          className="ml-2 text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/20 transition-colors disabled:opacity-40"
                        >
                          {retryingTx === tx.txHash ? '...' : 'Retry'}
                        </button>
                      )}
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
