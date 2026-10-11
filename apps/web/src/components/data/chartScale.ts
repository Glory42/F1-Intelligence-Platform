export type Scale = (value: number) => number;

export function linearScale([d0, d1]: [number, number], [r0, r1]: [number, number]): Scale {
  const span = d1 - d0;
  return (value) => (span === 0 ? (r0 + r1) / 2 : r0 + ((value - d0) / span) * (r1 - r0));
}

const E10 = Math.sqrt(50);
const E5 = Math.sqrt(10);
const E2 = Math.sqrt(2);

// Same "nice number" step selection as d3-array's ticks(): steps of 1, 2 or 5 × 10^n.
export function niceTicks(start: number, stop: number, count: number): number[] {
  if (start === stop) return [start];
  const rawStep = (stop - start) / count;
  const power = Math.floor(Math.log10(rawStep));
  const error = rawStep / 10 ** power;
  const factor = error >= E10 ? 10 : error >= E5 ? 5 : error >= E2 ? 2 : 1;

  if (power < 0) {
    const inverse = 10 ** -power / factor;
    const first = Math.ceil(start * inverse);
    const last = Math.floor(stop * inverse);
    return Array.from({ length: last - first + 1 }, (_, i) => (first + i) / inverse);
  }
  const step = factor * 10 ** power;
  const first = Math.ceil(start / step);
  const last = Math.floor(stop / step);
  return Array.from({ length: last - first + 1 }, (_, i) => (first + i) * step);
}
