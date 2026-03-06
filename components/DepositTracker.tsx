'use client';

import type { BridgeStatus } from '@/hooks/useBridge';

interface Props {
  status: BridgeStatus;
  txHash?: string;
  releaseTxHash?: string;
  sourceChainId?: number;
  error?: string;
  onReset?: () => void;
  confirmations?: number;
  requiredConfirmations?: number;
}

function chainName(chainId: number): string {
  if (chainId === 56) return 'BNB Chain';
  if (chainId === 1404) return 'BlockDAG';
  return `Chain ${chainId}`;
}

function explorerTxUrl(hash: string, chainId: number): string {
  if (chainId === 56) return `https://bscscan.com/tx/${hash}`;
  if (chainId === 1404) return `https://bdagscan.com/tx/${hash}`;
  return '#';
}

function explorerLabel(chainId: number): string {
  if (chainId === 56) return 'BSCScan';
  if (chainId === 1404) return 'BDAGScan';
  return 'Explorer';
}

function getStepIndex(status: BridgeStatus): number {
  const stepKeys = [
    ['approving'],
    ['depositing'],
    ['confirming', 'waiting_relayer'],
    ['released'],
  ];
  for (let i = 0; i < stepKeys.length; i++) {
    if (stepKeys[i].includes(status)) return i;
  }
  return -1;
}

export function DepositTracker({ status, txHash, releaseTxHash, sourceChainId, error, onReset, confirmations, requiredConfirmations }: Props) {
  if (status === 'idle' || status === 'switching') return null;

  const srcChain = sourceChainId || 56;
  const destChain = srcChain === 1404 ? 56 : 1404;
  const srcName = chainName(srcChain);
  const destName = chainName(destChain);

  const steps = [
    'Approve Token',
    'Deposit to Bridge',
    'Waiting for Confirmations',
    `Released on ${destName}`,
  ];

  const currentIdx = getStepIndex(status);
  const isComplete = status === 'released';
  const isError = status === 'error';
  const showConfirmations = (status === 'confirming' || status === 'waiting_relayer') &&
    confirmations !== undefined && requiredConfirmations !== undefined && confirmations > 0;
  const confCount = confirmations ?? 0;
  const confRequired = requiredConfirmations ?? 15;
  const confProgress = Math.min(confCount / confRequired, 1);

  return (
    <div className="mt-6 bg-card rounded-xl p-5 border border-gray-800">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-sm font-sans font-semibold text-gray-300">Bridge Status</h3>
        {(isComplete || isError) && onReset && (
          <button
            onClick={onReset}
            className="text-xs px-3 py-1 rounded-lg bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 transition-colors"
          >
            Bridge Again
          </button>
        )}
      </div>

      {/* Success banner */}
      {isComplete && (
        <div className="mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/30">
          <p className="text-green-400 text-sm font-semibold">Bridge complete! Tokens received on {destName}.</p>
        </div>
      )}

      {/* Waiting for relayer message */}
      {status === 'waiting_relayer' && (
        <div className="mb-4 p-3 rounded-lg bg-accent/10 border border-accent/30">
          <p className="text-accent text-sm">Deposit confirmed on {srcName}. Waiting for relayer to release on {destName}...</p>
          <p className="text-gray-500 text-xs mt-1">This usually takes 30-60 seconds.</p>
        </div>
      )}

      <div className="space-y-3">
        {steps.map((stepLabel, i) => {
          let state: 'done' | 'active' | 'pending' = 'pending';
          if (isError) {
            state = i <= Math.max(currentIdx, 0) ? 'active' : 'pending';
          } else if (isComplete) {
            state = 'done';
          } else if (i < currentIdx) {
            state = 'done';
          } else if (i === currentIdx) {
            state = 'active';
          }

          let label = stepLabel;
          if (i === 2 && showConfirmations) {
            label = `Waiting for Confirmations (${Math.min(confCount, confRequired)}/${confRequired})`;
          }

          return (
            <div key={i}>
              <div className="flex items-center gap-3">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs border shrink-0 ${
                  state === 'done' ? 'bg-green-500/20 border-green-500 text-green-400' :
                  state === 'active' ? 'bg-accent/20 border-accent text-accent animate-pulse' :
                  'border-gray-600 text-gray-500'
                }`}>
                  {state === 'done' ? '\u2713' : i + 1}
                </div>
                <span className={`text-sm ${
                  state === 'done' ? 'text-green-400' :
                  state === 'active' ? 'text-accent' :
                  'text-gray-500'
                }`}>
                  {label}
                </span>
              </div>
              {/* Confirmation progress bar */}
              {i === 2 && showConfirmations && state === 'active' && (
                <div className="ml-9 mt-1.5 mb-1">
                  <div className="h-1.5 rounded-full bg-gray-700 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-accent transition-all duration-500"
                      style={{ width: `${confProgress * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {txHash && (
        <div className="mt-3 space-y-1">
          <a
            href={explorerTxUrl(txHash, srcChain)}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-xs text-gray-500 hover:text-accent break-all transition-colors"
          >
            Deposit Tx ({explorerLabel(srcChain)}): {txHash}
          </a>
          {releaseTxHash && (
            <a
              href={explorerTxUrl(releaseTxHash, destChain)}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-xs text-green-500 hover:text-green-400 break-all transition-colors"
            >
              Release Tx ({explorerLabel(destChain)}): {releaseTxHash}
            </a>
          )}
        </div>
      )}
      {error && (
        <div className="mt-3 p-2 rounded bg-red-500/10 border border-red-500/20">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}
    </div>
  );
}
