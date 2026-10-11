import { useState, useMemo, useEffect } from 'react';
import type { Circuit } from '@/types';
import { getCountryFlag } from '@/lib/f1/countryFlags';
import { MapPin, Gauge, CornerDownRight, Wind, Zap } from 'lucide-react';

interface Props {
  initialCircuits: Circuit[];
}

function getRegion(country: string): string {
  const c = country.toLowerCase();
  if (['uk', 'united kingdom', 'monaco', 'italy', 'belgium', 'spain', 'germany', 'france', 'austria', 'netherlands', 'hungary', 'portugal', 'switzerland', 'sweden', 'finland', 'azerbaijan', 'turkey', 'san marino', 'europe'].some(x => c.includes(x))) return 'Europe';
  if (['usa', 'united states', 'canada', 'brazil', 'mexico', 'argentina'].some(x => c.includes(x))) return 'Americas';
  if (['japan', 'australia', 'china', 'singapore', 'korea', 'india', 'malaysia'].some(x => c.includes(x))) return 'Asia-Pacific';
  if (['bahrain', 'saudi arabia', 'uae', 'qatar', 'abu dhabi'].some(x => c.includes(x))) return 'Middle East';
  return 'Other';
}

const REGION_COLORS: Record<string, { border: string; bg: string; text: string; borderRaw: string; textRaw: string; gradient: string }> = {
  'All': { border: 'border-[#a855f7]/40', bg: 'bg-[#a855f7]/[0.12]', text: 'text-[#a855f7]', borderRaw: 'rgba(168, 85, 247, 0.4)', textRaw: '#a855f7', gradient: 'from-[#a855f7]/60 to-[#a855f7]' },
  'Europe': { border: 'border-[#10b981]/40', bg: 'bg-[#10b981]/[0.12]', text: 'text-[#10b981]', borderRaw: 'rgba(16, 185, 129, 0.4)', textRaw: '#10b981', gradient: 'from-[#10b981]/60 to-[#10b981]' },
  'Asia-Pacific': { border: 'border-[#06b6d4]/40', bg: 'bg-[#06b6d4]/[0.12]', text: 'text-[#06b6d4]', borderRaw: 'rgba(6, 182, 212, 0.4)', textRaw: '#06b6d4', gradient: 'from-[#06b6d4]/60 to-[#06b6d4]' },
  'Americas': { border: 'border-[#f97316]/40', bg: 'bg-[#f97316]/[0.12]', text: 'text-[#f97316]', borderRaw: 'rgba(249, 115, 22, 0.4)', textRaw: '#f97316', gradient: 'from-[#f97316]/60 to-[#f97316]' },
  'Middle East': { border: 'border-[#eab308]/40', bg: 'bg-[#eab308]/[0.12]', text: 'text-[#eab308]', borderRaw: 'rgba(234, 179, 8, 0.4)', textRaw: '#eab308', gradient: 'from-[#eab308]/60 to-[#eab308]' },
  'Other': { border: 'border-[#6b7280]/40', bg: 'bg-[#6b7280]/[0.12]', text: 'text-[#6b7280]', borderRaw: 'rgba(107, 114, 128, 0.4)', textRaw: '#6b7280', gradient: 'from-[#6b7280]/60 to-[#6b7280]' },
};

export function CircuitsGrid({ initialCircuits }: Props) {
  const [selectedRegion, setSelectedRegion] = useState('All');
  const [sortBy, setSortBy] = useState<'name' | 'length' | 'overtake'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const filteredAndSortedCircuits = useMemo(() => {
    let result = [...initialCircuits];

    // Region filter
    if (selectedRegion !== 'All') {
      result = result.filter((c) => getRegion(c.country) === selectedRegion);
    }

    // Sort
    result.sort((a, b) => {
      let compareVal = 0;
      if (sortBy === 'name') {
        compareVal = a.name.localeCompare(b.name);
      } else if (sortBy === 'length') {
        compareVal = parseFloat(a.trackLengthKm) - parseFloat(b.trackLengthKm);
      } else if (sortBy === 'overtake') {
        compareVal = parseFloat(a.overtakeRate ?? '0') - parseFloat(b.overtakeRate ?? '0');
      }
      return sortOrder === 'asc' ? compareVal : -compareVal;
    });

    return result;
  }, [initialCircuits, selectedRegion, sortBy, sortOrder]);

  // Fade the grid on filter/sort change without unmounting/remounting every card
  const [gridVisible, setGridVisible] = useState(true);
  useEffect(() => {
    setGridVisible(false);
    const id = requestAnimationFrame(() => setGridVisible(true));
    return () => cancelAnimationFrame(id);
  }, [selectedRegion, sortBy, sortOrder]);

  const regions = ['All', 'Europe', 'Asia-Pacific', 'Americas', 'Middle East'];

  return (
    <div className="space-y-6">
      {/* Filters and Sorting Bar */}
      <div className="flex flex-col md:flex-row gap-4 justify-between items-stretch md:items-center">
        {/* Region Tabs */}
        <div className="flex flex-wrap items-center gap-1">
          {regions.map((region) => {
            const active = selectedRegion === region;
            const colors = REGION_COLORS[region] || REGION_COLORS['Other'];
            return (
              <button
                key={region}
                onClick={() => setSelectedRegion(region)}
                className={`font-mono text-[9px] tracking-[0.12em] uppercase px-3 py-1.5 border border-white/[0.08] transition-all duration-150 ${
                  active
                    ? `${colors.bg} ${colors.text} ${colors.border}`
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {region}
              </button>
            );
          })}
        </div>

        {/* Sort Controls */}
        <div className="flex items-center gap-2">
          {/* Sort dimension options */}
          <div className="flex items-center border border-white/[0.08] overflow-hidden">
            {([
              { id: 'name', label: 'Name' },
              { id: 'length', label: 'Length' },
              { id: 'overtake', label: 'Overtakes' }
            ] as const).map((opt) => {
              const active = sortBy === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => setSortBy(opt.id)}
                  className={`font-mono text-[8px] tracking-[0.15em] uppercase px-3 py-1.5 transition-colors duration-150 ${
                    active
                      ? 'bg-[rgba(168,85,247,0.12)] text-[#a855f7]'
                      : 'text-muted-foreground hover:text-foreground'
                  } border-r border-white/[0.08] last:border-r-0`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* Sort Direction Toggle */}
          <button
            onClick={() => setSortOrder(order => order === 'asc' ? 'desc' : 'asc')}
            className="flex items-center gap-1.5 font-mono text-[8px] tracking-[0.15em] uppercase px-3 py-1.5 border border-white/[0.08] text-muted-foreground hover:text-foreground transition-colors duration-150"
            title={sortOrder === 'asc' ? 'Sort descending' : 'Sort ascending'}
          >
            {sortOrder === 'asc' ? '↑ ASC' : '↓ DESC'}
          </button>
        </div>
      </div>

      {/* Grid of Circuit Cards */}
      {filteredAndSortedCircuits.length > 0 ? (
        <div
          className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 transition-opacity duration-200 ease-spring ${
            gridVisible ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {filteredAndSortedCircuits.map((circuit) => {
            const overtakePct = circuit.overtakeRate ? Math.round(parseFloat(circuit.overtakeRate) * 100) : null;
            const circuitRegion = getRegion(circuit.country);
            const colors = REGION_COLORS[circuitRegion] || REGION_COLORS['Other'];
            return (
              <a
                key={circuit.id}
                href={`/circuits/${circuit.circuitKey}`}
                className="group border border-white/[0.06] bg-black hover:border-white/[0.15] hover:shadow-[0_0_15px_rgba(255,255,255,0.015)] flex flex-col justify-between overflow-hidden transition-all duration-300 transform hover:-translate-y-0.5"
                style={{
                  borderLeft: `3px solid ${colors.borderRaw}`,
                  '--hover-color': colors.textRaw,
                } as React.CSSProperties}
              >
                {/* Card Header */}
                <div className="p-5 space-y-3">
                  <div className="flex justify-between items-start gap-2">
                    <h3 className="font-bold text-base transition-colors duration-150 truncate max-w-[80%] [color:var(--text-color)] group-hover:[color:var(--hover-color)]">
                      {circuit.name}
                    </h3>
                    <span className="text-xl shrink-0 select-none" title={circuit.country}>
                      {getCountryFlag(circuit.country)}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 font-mono text-[9px] text-muted-foreground tracking-[0.08em] uppercase">
                    <MapPin size={10} className="shrink-0" />
                    <span className="truncate">{circuit.city}, {circuit.country}</span>
                  </div>
                </div>

                {/* Card Footer / Stats */}
                <div className="border-t border-white/[0.04] p-5 space-y-4 bg-white/[0.01]">
                  {/* Miniature Stats Row */}
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <div className="flex items-center gap-1 font-mono text-[7px] text-muted-foreground tracking-widest uppercase mb-0.5">
                        <Gauge size={8} /> Length
                      </div>
                      <div className="font-mono text-xs font-semibold">{circuit.trackLengthKm} km</div>
                    </div>
                    <div>
                      <div className="flex items-center gap-1 font-mono text-[7px] text-muted-foreground tracking-widest uppercase mb-0.5">
                        <CornerDownRight size={8} /> Corners
                      </div>
                      <div className="font-mono text-xs font-semibold">{circuit.numberOfCorners ?? '-'}</div>
                    </div>
                    <div>
                      <div className="flex items-center gap-1 font-mono text-[7px] text-muted-foreground tracking-widest uppercase mb-0.5">
                        <Wind size={8} /> DRS Zones
                      </div>
                      <div className="font-mono text-xs font-semibold">{circuit.drsZones ?? '-'}</div>
                    </div>
                  </div>

                  {/* Overtake Progress Bar */}
                  {overtakePct !== null && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-[7px] font-mono text-muted-foreground tracking-widest uppercase">
                        <span className="flex items-center gap-1"><Zap size={8} /> Overtake Rate</span>
                        <span className="font-bold [color:var(--hover-color)]">{overtakePct}%</span>
                      </div>
                      <div className="w-full h-1 bg-white/[0.04] overflow-hidden relative">
                        <div
                          className={`h-full bg-gradient-to-r ${colors.gradient} bar-fill`}
                          style={{ width: `${overtakePct}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </a>
            );
          })}
        </div>
      ) : (
        <div className="border border-white/[0.06] p-12 text-center">
          <MapPin size={24} className="text-muted-foreground opacity-20 mx-auto mb-3" />
          <p className="font-mono text-[9px] text-muted-foreground tracking-[0.25em] uppercase">No circuits match your criteria</p>
        </div>
      )}
    </div>
  );
}
