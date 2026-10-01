export function Sparkline({ data, ideal, width = 96, height = 28, color = 'var(--series-1)', label = 'Son 60 dakika üretim hızı' }: { data: number[]; ideal: number; width?: number; height?: number; color?: string; label?: string }) {
  if (data.length < 2) return null
  const max = Math.max(ideal * 1.05, ...data)
  const x = (i: number) => (i / (data.length - 1)) * (width - 2) + 1
  const y = (v: number) => height - 2 - (v / max) * (height - 4)
  const pts = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <line x1={0} x2={width} y1={y(ideal)} y2={y(ideal)} stroke="var(--fg-3)" strokeWidth={1} strokeDasharray="3 3" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
