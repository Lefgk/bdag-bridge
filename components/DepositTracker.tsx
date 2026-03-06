'use client';

interface Props {
  status: 'idle' | 'approving' | 'depositing' | 'pending' | 'confirmed' | 'released' | 'error';
  txHash?: string;
  error?: string;
}

const STEPS = [
  { key: 'approving', label: 'Approve Token' },
  { key: 'depositing', label: 'Deposit to Bridge' },
  { key: 'pending', label: 'Waiting for Confirmations' },
  { key: 'released', label: 'Released on BlockDAG' },
] as const;

export function DepositTracker({ status, txHash, error }: Props) {
  if (status === 'idle') return null;

  const stepOrder = STEPS.map(s => s.key);
  const currentIdx = stepOrder.indexOf(status as any);

  return (
    <div className="mt-6 bg-card rounded-xl p-4 border border-gray-800">
      <h3 className="text-sm font-sans font-semibold text-gray-300 mb-3">Bridge Status</h3>
      <div className="space-y-3">
        {STEPS.map((step, i) => {
          let state: 'done' | 'active' | 'pending' = 'pending';
          if (status === 'error') {
            state = i <= currentIdx ? 'active' : 'pending';
          } else if (i < currentIdx) {
            state = 'done';
          } else if (i === currentIdx) {
            state = 'active';
          }

          return (
            <div key={step.key} className="flex items-center gap-3">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs border ${
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
        <p className="mt-3 text-xs text-gray-500 break-all">
          Tx: {txHash}
        </p>
      )}
      {error && (
        <p className="mt-3 text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}
