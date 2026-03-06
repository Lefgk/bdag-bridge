'use client';

import type { BridgeStatus } from '@/hooks/useBridge';

interface Props {
  status: BridgeStatus;
  txHash?: string;
  error?: string;
  onReset?: () => void;
}

const STEPS = [
  { keys: ['approving'], label: 'Approve Token' },
  { keys: ['depositing'], label: 'Deposit to Bridge' },
  { keys: ['confirming', 'waiting_relayer'], label: 'Waiting for Confirmations' },
  { keys: ['released'], label: 'Released on BlockDAG' },
] as const;

function getStepIndex(status: BridgeStatus): number {
  for (let i = 0; i < STEPS.length; i++) {
    if ((STEPS[i].keys as readonly string[]).includes(status)) return i;
  }
  return -1;
}

export function DepositTracker({ status, txHash, error, onReset }: Props) {
  if (status === 'idle' || status === 'switching') return null;

  const currentIdx = getStepIndex(status);
  const isComplete = status === 'released';
  const isError = status === 'error';

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
          <p className="text-green-400 text-sm font-semibold">Bridge complete! Tokens received on BlockDAG.</p>
        </div>
      )}

      {/* Waiting for relayer message */}
      {status === 'waiting_relayer' && (
        <div className="mb-4 p-3 rounded-lg bg-accent/10 border border-accent/30">
          <p className="text-accent text-sm">Deposit confirmed on BSC. Waiting for relayer to release on BlockDAG...</p>
          <p className="text-gray-500 text-xs mt-1">This usually takes 30-60 seconds.</p>
        </div>
      )}

      <div className="space-y-3">
        {STEPS.map((step, i) => {
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

          return (
            <div key={i} className="flex items-center gap-3">
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
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      {txHash && (
        <a
          href={`https://bscscan.com/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 block text-xs text-gray-500 hover:text-accent break-all transition-colors"
        >
          BSC Tx: {txHash}
        </a>
      )}
      {error && (
        <div className="mt-3 p-2 rounded bg-red-500/10 border border-red-500/20">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}
    </div>
  );
}
