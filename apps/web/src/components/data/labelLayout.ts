// End-of-line chart labels: nudge them apart vertically so no two overlap, without changing their
// order, and keep them within [min, max]. Returns positions in the input order.
export function spreadLabels(ys: number[], minGap: number, min: number, max: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const placed = order.map((o) => Math.min(Math.max(o.y, min), max));
  for (let k = 1; k < placed.length; k++) placed[k] = Math.max(placed[k], placed[k - 1] + minGap);
  if (placed.length > 0 && placed[placed.length - 1] > max) {
    placed[placed.length - 1] = max;
    for (let k = placed.length - 2; k >= 0; k--) placed[k] = Math.min(placed[k], placed[k + 1] - minGap);
  }
  const result = new Array<number>(ys.length);
  order.forEach((o, k) => { result[o.i] = placed[k]; });
  return result;
}
