export function Sparkline({ prices, width = 72, height = 22 }: { prices: number[]; width?: number; height?: number }) {
  if (prices.length < 2) return null;
  const min = Math.min(...prices);
  const span = Math.max(...prices) - min || 1;
  const step = (width - 6) / (prices.length - 1);
  const xy = prices.map((p, i) => [3 + i * step, 3 + (1 - (p - min) / span) * (height - 6)] as const);
  const points = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [lastX, lastY] = xy[xy.length - 1]!;
  const trend = prices[prices.length - 1]! < prices[0]! ? 'down' : 'flat';
  return (
    <svg width={width} height={height} role="img" aria-label="Storico prezzi" className={`sparkline sparkline--${trend}`}>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={2.5} fill="currentColor" />
    </svg>
  );
}
