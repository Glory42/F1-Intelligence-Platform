interface Props {
  isCareer: boolean;
  setIsCareer: (isCareer: boolean) => void;
}

export function CompareModeToggle({ isCareer, setIsCareer }: Props) {
  return (
    <div className="flex h-9 items-stretch border border-white/[0.08] overflow-hidden">
      <button
        onClick={() => setIsCareer(false)}
        className={`font-mono text-[8px] tracking-[0.15em] uppercase px-3 transition-colors duration-150 ${
          !isCareer
            ? 'bg-[rgba(168,85,247,0.12)] text-[#a855f7]'
            : 'text-muted-foreground hover:text-foreground'
        } border-r border-white/[0.08]`}
      >
        Season
      </button>
      <button
        onClick={() => setIsCareer(true)}
        className={`font-mono text-[8px] tracking-[0.15em] uppercase px-3 transition-colors duration-150 ${
          isCareer
            ? 'bg-[rgba(168,85,247,0.12)] text-[#a855f7]'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        Career
      </button>
    </div>
  );
}
