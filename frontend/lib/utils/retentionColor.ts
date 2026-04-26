export function retentionToColor(pct: number): string {
  const clamped = Math.max(0, Math.min(100, pct))
  return `color-mix(in oklab, var(--success) ${clamped}%, var(--destructive) ${100 - clamped}%)`
}

/**
 * Maps a video second to the correct index in resolvedRetentionSeries.
 * The curve uses a non-linear structure: indices 0-14 = seconds 0-14 (1:1),
 * then index 15=15s, 16=20s, 17=25s, 18=30s, 19=40s, 20=50s, 21=60s+.
 */
export function secondToRetentionIndex(second: number): number {
  if (second < 15) return Math.floor(second)
  if (second < 20) return 15
  if (second < 25) return 16
  if (second < 30) return 17
  if (second < 40) return 18
  if (second < 50) return 19
  if (second < 60) return 20
  return 21
}

export function findHookBoundary(words: { start: number; text: string }[]): number {
  // First punctuation token whose start > 3000ms and start ≤ 5000ms
  const i = words.findIndex(w => w.start > 3000 && w.start <= 5000 && /[.!?,]$/.test(w.text))
  if (i !== -1) return i + 1
  // Fallback: first punctuation after 3000ms, no cap
  const j = words.findIndex(w => w.start > 3000 && /[.!?,]$/.test(w.text))
  if (j !== -1) return j + 1
  // Final fallback: first word past 3000ms
  const k = words.findIndex(w => w.start > 3000)
  return k !== -1 ? k : words.length
}
