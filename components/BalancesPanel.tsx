'use client';

import { useRelayerBalances } from '@/hooks/useRelayerBalances';
import { chainName } from '@/config/chainUtils';

function StatusBadge({ paused, txsRemaining, warning, critical }: {
  paused: boolean;
  txsRemaining: number;
  warning: number;
  critical: number;
}) {
  if (paused) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/15 text-red-400 border border-red-500/30">
        <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
        PAUSED
      </span>
    );
  }
  if (txsRemaining < critical) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/15 text-red-400 border border-red-500/30">
        CRITICAL
      </span>
    );
  }
  if (txsRemaining < warning) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-yellow-500/15 text-yellow-400 border border-yellow-500/30">
        LOW
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-500/15 text-green-400 border border-green-500/30">
      <span className="w-2 h-2 rounded-full bg-green-400" />
      OK
    </span>
  );
}

function timeAgo(ts: number): string {
  if (!ts) return 'never';
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export function BalancesPanel() {
  const { data, loading, error, refetch } = useRelayerBalances();

  return (
    <div className="space-y-6 py-8">
      <div className="text-center">
        <h1 className="text-3xl font-sans font-bold text-white mb-2">Relayer Balances</h1>
        <p className="text-gray-400 text-sm">
          Live gas balances for the bridge relayer across all chains
        </p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-center">
          <p className="text-red-400 text-sm">{error}</p>
          <button
            onClick={refetch}
            className="mt-2 px-4 py-1.5 text-xs bg-red-500/20 text-red-300 rounded-lg hover:bg-red-500/30 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {loading && !data && (
        <div className="text-center py-12">
          <div className="inline-block w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm mt-3">Loading balances...</p>
        </div>
      )}

      {data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-card rounded-xl p-4 border border-gray-800">
              <p className="text-gray-500 text-xs mb-1">Chains</p>
              <p className="text-white text-xl font-mono">{data.balances.length}</p>
            </div>
            <div className="bg-card rounded-xl p-4 border border-gray-800">
              <p className="text-gray-500 text-xs mb-1">Healthy</p>
              <p className="text-green-400 text-xl font-mono">
                {data.balances.filter(b => !b.paused && b.txsRemaining >= data.warningThreshold).length}
              </p>
            </div>
            <div className="bg-card rounded-xl p-4 border border-gray-800">
              <p className="text-gray-500 text-xs mb-1">Low</p>
              <p className="text-yellow-400 text-xl font-mono">
                {data.balances.filter(b => !b.paused && b.txsRemaining < data.warningThreshold && b.txsRemaining >= data.criticalThreshold).length}
              </p>
            </div>
            <div className="bg-card rounded-xl p-4 border border-gray-800">
              <p className="text-gray-500 text-xs mb-1">Paused</p>
              <p className="text-red-400 text-xl font-mono">
                {data.balances.filter(b => b.paused).length}
              </p>
            </div>
          </div>

          {/* Relayer address */}
          {data.relayer && (
            <div className="bg-card rounded-xl p-4 border border-gray-800 flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-xs mb-1">Relayer Address</p>
                <p className="text-white font-mono text-sm break-all">{data.relayer}</p>
              </div>
              <button
                onClick={refetch}
                disabled={loading}
                className="px-4 py-2 text-sm bg-accent/10 text-accent border border-accent/30 rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
              >
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          )}

          {/* Balance table */}
          <div className="bg-card rounded-2xl border border-gray-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 text-xs border-b border-gray-800">
                    <th className="text-left px-5 py-3 font-medium">Chain</th>
                    <th className="text-right px-5 py-3 font-medium">Balance</th>
                    <th className="text-right px-5 py-3 font-medium">Txs Remaining</th>
                    <th className="text-center px-5 py-3 font-medium">Status</th>
                    <th className="text-right px-5 py-3 font-medium">Last Check</th>
                  </tr>
                </thead>
                <tbody>
                  {data.balances.map((b) => (
                    <tr
                      key={b.chainId}
                      className={`border-b border-gray-800/50 transition-colors ${
                        b.paused ? 'bg-red-500/5' : ''
                      }`}
                    >
                      <td className="px-5 py-4">
                        <span className="text-white font-medium">{b.chainName}</span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <span className="font-mono text-white">
                          {Number(b.balance).toFixed(4)}
                        </span>
                        <span className="text-gray-500 ml-1.5">{b.symbol}</span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <span className={`font-mono ${
                          b.paused ? 'text-red-400' :
                          b.txsRemaining < data.criticalThreshold ? 'text-red-400' :
                          b.txsRemaining < data.warningThreshold ? 'text-yellow-400' :
                          'text-green-400'
                        }`}>
                          ~{b.txsRemaining}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-center">
                        <StatusBadge
                          paused={b.paused}
                          txsRemaining={b.txsRemaining}
                          warning={data.warningThreshold}
                          critical={data.criticalThreshold}
                        />
                      </td>
                      <td className="px-5 py-4 text-right text-gray-500 text-xs">
                        {timeAgo(b.lastChecked)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-gray-600 text-xs text-center">
            Auto-refreshes every 30 seconds. Relayer checks balances every 5 minutes.
          </p>
        </>
      )}
    </div>
  );
}
