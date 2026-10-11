interface Props {
  years: number[];
  year: number;
  setYear: (year: number) => void;
}

export function CompareYearSelect({ years, year, setYear }: Props) {
  return (
    <div className="relative w-full">
      <select
        value={year}
        onChange={(e) => setYear(parseInt(e.target.value))}
        className="appearance-none w-full h-9 bg-black border border-white/[0.08] text-white text-xs font-mono pl-3 pr-8 uppercase tracking-wider cursor-pointer focus:outline-none focus:border-[#a855f7]/40"
      >
        {years.map((y) => (
          <option key={y} value={y}>{y} Season</option>
        ))}
      </select>
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none text-[8px] font-mono select-none">
        ▼
      </span>
    </div>
  );
}
