'use client';

// LiquidityPanel removed in v7 — no more liquidity pools.
// ProsperityBridge v7 uses lock-and-mint / burn-and-release with no LP tokens.

export function LiquidityPanel() {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-sans font-bold text-white mb-2">Liquidity</h1>
        <p className="text-gray-400 text-sm">
          Liquidity pools have been removed in Prosperity Bridge v7.
        </p>
        <p className="text-gray-500 text-xs mt-2">
          The bridge now uses a lock-and-mint / burn-and-release model with no LP tokens.
        </p>
      </div>
    </div>
  );
}
