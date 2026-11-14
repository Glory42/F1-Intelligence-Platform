export type SummarySeries = {
  label: string;
  color: string;
  points: Array<{ x: number; y: number | null }>;
};

// Team-mates share a team colour and some teams' colours are near-identical, so a repeated colour
// gets a dash pattern: the lines stay apart without relying on colour alone.
const DASHES = ['', '6 3', '2 3', '8 3 2 3'];

export function lineDashes(colors: string[]): string[] {
  const seen = new Map<string, number>();
  return colors.map((color) => {
    const key = color.toLowerCase();
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    return DASHES[count % DASHES.length];
  });
}

// What a screen reader gets instead of the lines: each series' last value, in series order.
export function lineChartSummary(
  series: SummarySeries[],
  formatY: (value: number) => string,
  xLabel?: string,
): string {
  const ends = series.flatMap((s) => {
    const last = [...s.points].reverse().find((p) => p.y != null);
    if (!last || last.y == null) return [];
    return [`${s.label} ${formatY(last.y)}${xLabel ? ` at ${xLabel} ${last.x}` : ''}`];
  });
  return ends.length === 0 ? 'No data.' : `Last values: ${ends.join('; ')}.`;
}
