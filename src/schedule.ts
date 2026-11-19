/** Weighted pick that never returns the same key more than `maxRepeat` times in a row. */
export function pickNext<K extends string>(
  weights: Record<K, number>,
  history: K[],
  maxRepeat: number,
  rand: () => number = Math.random,
): K {
  const recent = history.slice(-maxRepeat);
  const banned = recent.length === maxRepeat && recent.every((k) => k === recent[0]) ? recent[0] : null;
  const entries = (Object.entries(weights) as [K, number][]).filter(([k]) => k !== banned);
  let r = rand() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) if ((r -= w) < 0) return k;
  return entries[entries.length - 1][0];
}
