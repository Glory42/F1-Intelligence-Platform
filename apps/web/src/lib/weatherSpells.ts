export interface RainSpell {
  from: number;
  to: number;
}

export function rainSpells(minuteOffsets: number[], rainfall: boolean[]): RainSpell[] {
  const spells: RainSpell[] = [];
  rainfall.forEach((wet, i) => {
    if (!wet) return;
    const last = spells[spells.length - 1];
    if (last && rainfall[i - 1]) last.to = minuteOffsets[i];
    else spells.push({ from: minuteOffsets[i], to: minuteOffsets[i] });
  });
  return spells;
}
