interface Props {
  slot: 'A' | 'B';
  color: string;
}

export function CompareSlotBadge({ slot, color }: Props) {
  return (
    <span
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center border font-mono text-[8px] font-bold text-white"
      style={{ borderColor: color }}
      aria-label={`Side ${slot}`}
    >
      {slot}
    </span>
  );
}
