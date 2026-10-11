export function Sparkline({ prices, width = 90, height = 18 }: { prices: number[]; width?: number; height?: number }) {
  if (prices.length < 2) return null;
  const min = Math.min(...prices);
  const span = Math.max(...prices) - min || 1;
  const step = (width - 4) / (prices.length - 1);
  const points = prices
    .map((p, i) => `${(2 + i * step).toFixed(1)},${(2 + (1 - (p - min) / span) * (height - 4)).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={width} height={height} role="img" aria-label="Storico prezzi" className="sparkline">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={2} />
    </svg>
  );
}
