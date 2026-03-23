import { redirect } from 'next/navigation';

// Liquidity pools removed in v7
export default function LiquidityPage() {
  redirect('/');
}
