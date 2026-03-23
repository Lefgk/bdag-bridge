'use client';

import type { BridgeStatus } from '@/hooks/useBridge';
import { chainName, explorerTxUrl, getHyperlaneExplorerUrl } from '@/config/chainUtils';

interface Props {
  status: BridgeStatus;
  txHash?: string;
  messageId?: string;
  sourceChainId?: number;
  destChainId?: number;
  depositBlock?: number;
  error?: string;
  onReset?: () => void;
  confirmations?: number;
  requiredConfirmations?: number;
}

function getStepIndex(status: BridgeStatus): number {
  const stepKeys = [
    ['approving'],
    ['depositing'],
    ['confirming', 'waiting_delivery'],
    ['delivered'],
  ];
  for (let i = 0; i < stepKeys.length; i++) {
    if (stepKeys[i].includes(status)) return i;
  }
  return -1;
}

export function DepositTracker({ status, txHash, messageId, sourceChainId, destChainId, depositBlock, error, onReset, confirmations, requiredConfirmations }: Props) {
  if (status === 'idle' || status === 'switching') return null;

  const srcChain = sourceChainId || 56;
  const dstChain = destChainId || 1404;
  const srcName = chainName(srcChain);
  const destName = chainName(dstChain);

  const steps = [
    'Approve Token',
    'Deposit to Bridge',
    'Hyperlane Message Delivery',
    `Delivered on ${destName}`,
  ];

  const currentIdx = getStepIndex(status);
  const isComplete = status === 'delivered';
  const isError = status === 'error';
  const showConfirmations = (status === 'confirming' || status === 'waiting_delivery') &&
    confirmations !== undefined && requiredConfirmations !== undefined && confirmations > 0;
  const confCount = confirmations ?? 0;
  const confRequired = requiredConfirmations ?? 15;
  const confProgress = Math.min(confCount / confRequired, 1);

  return (
    <div className="mt-6 bg-card rounded-xl p-5 border border-gray-800">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-sm font-sans font-semibold text-gray-300">Bridge Status</h3>
        {onReset && (
          <button
            onClick={onReset}
            className={`text-xs px-3 py-1 rounded-lg border transition-colors ${isComplete || isError
                ? 'bg-accent/10 text-accent border-accent/30 hover:bg-accent/20'
                : 'bg-gray-800 text-gray-400 border-gray-600 hover:text-gray-300 hover:border-gray-500'
              }`}
          >
            {isComplete || isError ? 'Bridge Again' : 'Cancel'}
          </button>
        )}
      </div>

      {isComplete && (
        <div className="mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/30">
          <p className="text-green-400 text-sm font-semibold">Bridge complete! Tokens delivered on {destName}.</p>
        </div>
      )}

      {status === 'waiting_delivery' && (
        <div className="mb-4 p-3 rounded-lg bg-accent/10 border border-accent/30">
          <p className="text-accent text-sm">Deposit confirmed on {srcName}. Waiting for Hyperlane delivery to {destName}...</p>
          <p className="text-gray-500 text-xs mt-1">This usually takes 1-5 minutes depending on the chains.</p>
          {messageId && (
            <a
              href={getHyperlaneExplorerUrl(messageId)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-accent hover:text-accent-dim mt-1 inline-block"
            >
              Track on Hyperlane Explorer ↗
            </a>
          )}
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
            label = `Hyperlane Message Delivery (${Math.min(confCount, confRequired)}/${confRequired} confirmations)`;
          }

          return (
            <div key={i}>
              <div className="flex items-center gap-3">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs border shrink-0 ${state === 'done' ? 'bg-green-500/20 border-green-500 text-green-400' :
                    state === 'active' ? 'bg-accent/20 border-accent text-accent animate-pulse' :
                      'border-gray-600 text-gray-500'
                  }`}>
                  {state === 'done' ? '\u2713' : i + 1}
                </div>
                <span className={`text-sm ${state === 'done' ? 'text-green-400' :
                    state === 'active' ? 'text-accent' :
                      'text-gray-500'
                  }`}>
                  {label}
                </span>
              </div>
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
        <div className="mt-4 bg-bg-dark/50 rounded-lg p-3 space-y-2">
          {depositBlock && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Deposit Block</span>
              <span className="text-xs font-mono text-gray-300">#{depositBlock.toLocaleString()}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-gray-500 shrink-0">Deposit Tx</span>
            <a
              href={explorerTxUrl(txHash, srcChain)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-400 hover:text-accent truncate font-mono transition-colors"
            >
              {txHash.slice(0, 10)}...{txHash.slice(-8)} ↗
            </a>
          </div>
          {messageId && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-gray-500 shrink-0">Hyperlane</span>
              <a
                href={getHyperlaneExplorerUrl(messageId)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-accent hover:text-accent-dim truncate font-mono transition-colors"
              >
                Track Message ↗
              </a>
            </div>
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
