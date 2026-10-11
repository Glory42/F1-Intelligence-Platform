// Telemetry x/y (y up) → SVG points (y down) in a size×size viewBox, aspect ratio preserved.
export function projectTrack(x: number[], y: number[], size: number): Array<[number, number]> {
  const minX = Math.min(...x);
  const minY = Math.min(...y);
  const spanX = Math.max(...x) - minX;
  const spanY = Math.max(...y) - minY;
  const scale = size / Math.max(spanX, spanY, 1);
  const offsetX = (size - spanX * scale) / 2;
  const offsetY = (size - spanY * scale) / 2;
  return x.map((xi, i) => [
    Math.round(offsetX + (xi - minX) * scale),
    Math.round(size - offsetY - (y[i] - minY) * scale),
  ]);
}
