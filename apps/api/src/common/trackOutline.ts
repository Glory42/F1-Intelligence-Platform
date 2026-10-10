// Pole-lap x/y from OpenF1 telemetry → a closed SVG path in a size×size viewBox.
export function buildOutlinePath(x: number[], y: number[], size: number): string {
  const minX = Math.min(...x);
  const maxX = Math.max(...x);
  const minY = Math.min(...y);
  const maxY = Math.max(...y);
  const scale = size / Math.max(maxX - minX, maxY - minY, 1);
  const offsetX = (size - (maxX - minX) * scale) / 2;
  const offsetY = (size - (maxY - minY) * scale) / 2;
  const point = (i: number) => {
    const px = Math.round(offsetX + (x[i] - minX) * scale);
    const py = Math.round(size - offsetY - (y[i] - minY) * scale);
    return `${px},${py}`;
  };
  return x.map((_, i) => `${i === 0 ? 'M' : 'L'}${point(i)}`).join('') + 'Z';
}
