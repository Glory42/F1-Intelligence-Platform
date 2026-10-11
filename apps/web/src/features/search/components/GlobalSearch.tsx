import { useState } from "react";
import { Command } from "cmdk";
import { Search, Building2 } from "lucide-react";
import { getTeamLogo } from "@/lib/f1/teamLogos";
import { getCountryFlag } from "@/lib/f1/countryFlags";
import { useGlobalSearch } from "@/features/search/useGlobalSearch";

export function GlobalSearch() {
  const { isVisible, closing, results, loading, close, selectResult } = useGlobalSearch();
  const [activeFilter, setActiveFilter] = useState<'all' | 'drivers' | 'teams' | 'circuits'>('all');
  const { drivers, teams, circuits } = results;

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh] sm:pt-[25vh]">
      <div
        className={`search-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm z-0 ${closing ? 'closing' : ''}`}
        aria-hidden="true"
        onClick={close}
      />

      <div className={`search-panel relative z-10 w-[90vw] max-w-[500px] ${closing ? 'closing' : ''}`}>
        <Command
          label="Global Command Menu"
          className="glass-heavy flex w-full flex-col overflow-hidden rounded-xl border border-white/10 shadow-2xl"
        >
        {/* Search input header */}
        <div className="flex items-center border-b border-white/10 px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <Command.Input
            autoFocus
            placeholder="Search drivers, teams, and circuits..."
            className="flex h-12 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
          />
          <div className="hidden sm:flex items-center gap-1">
            <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-white/10 bg-white/5 px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
              <span className="text-xs">ESC</span>
            </kbd>
          </div>
        </div>

        {/* Category Filter Pills (Discover options) */}
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/10 bg-white/[0.01] overflow-x-auto select-none">
          {(['all', 'drivers', 'teams', 'circuits'] as const).map((filter) => {
            const active = activeFilter === filter;
            return (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                className={`font-mono text-[8px] tracking-widest uppercase px-2.5 py-1 border transition-colors duration-150 focus:outline-none shrink-0 ${
                  active
                    ? 'border-[#a855f7]/60 bg-[#a855f7]/10 text-[#a855f7]'
                    : 'border-white/[0.06] text-muted-foreground hover:text-white hover:bg-white/[0.02]'
                }`}
              >
                {filter}
              </button>
            );
          })}
        </div>

        <Command.List className="max-h-[300px] overflow-y-auto overflow-x-hidden p-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
          <Command.Empty className="py-6 text-center text-sm">
            {loading ? "Loading..." : "No results found."}
          </Command.Empty>

          {!loading && (activeFilter === 'all' || activeFilter === 'drivers') && drivers.length > 0 && (
            <Command.Group heading="Drivers">
              {drivers.map((driver) => (
                <Command.Item
                  key={driver.id}
                  value={`${driver.fullName} ${driver.code} ${driver.team.name}`}
                  onSelect={() => selectResult(`/drivers/${driver.id}`)}
                  className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-2 text-sm outline-none data-[selected=true]:bg-white/10 data-[selected=true]:text-accent-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50"
                >
                  <div className="flex items-center w-full">
                    {driver.headshotUrl ? (
                      <img
                        src={driver.headshotUrl}
                        alt={driver.fullName}
                        className="mr-3 h-6 w-6 rounded-full object-cover object-top border border-white/10 bg-white/5"
                      />
                    ) : (
                      <div className="mr-3 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5">
                        <span className="font-mono text-[8px] font-bold text-muted-foreground">
                          {driver.driverNumber}
                        </span>
                      </div>
                    )}
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold truncate">{driver.fullName}</span>
                        <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                          {driver.code}
                        </span>
                      </div>
                      <span className="font-mono text-[9px] text-muted-foreground/70 truncate">
                        {driver.team.name}
                      </span>
                    </div>
                  </div>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {!loading && (activeFilter === 'all' || activeFilter === 'teams') && teams.length > 0 && (
            <Command.Group heading="Teams">
              {teams.map((team) => {
                const logo = getTeamLogo(team.teamKey);
                return (
                  <Command.Item
                    key={team.id}
                    value={team.name}
                    onSelect={() => selectResult(`/teams/${team.id}`)}
                    className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-2 text-sm outline-none data-[selected=true]:bg-white/10 data-[selected=true]:text-accent-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50"
                  >
                    <div className="flex items-center w-full">
                      {logo ? (
                        <div className="mr-3 flex h-6 w-8 shrink-0 items-center justify-center">
                          <img
                            src={logo}
                            alt={team.name}
                            className="max-h-full max-w-full object-contain"
                          />
                        </div>
                      ) : (
                        <div className="mr-3 flex h-6 w-8 shrink-0 items-center justify-center border border-white/10 bg-white/5 rounded-sm">
                          <Building2 size={12} className="opacity-50" />
                        </div>
                      )}
                      <span className="font-semibold truncate">{team.name}</span>
                    </div>
                  </Command.Item>
                );
              })}
            </Command.Group>
          )}

          {!loading && (activeFilter === 'all' || activeFilter === 'circuits') && circuits.length > 0 && (
            <Command.Group heading="Circuits">
              {circuits.map(circuit => (
                <Command.Item
                  key={circuit.id}
                  value={`${circuit.name} ${circuit.country} ${circuit.city}`}
                  onSelect={() => selectResult(`/circuits/${circuit.circuitKey}`)}
                  className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-2 text-sm outline-none data-[selected=true]:bg-white/10 data-[selected=true]:text-accent-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50"
                >
                  <div className="flex items-center w-full">
                    <div className="mr-3 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-white/10 bg-white/5 text-xs">
                      {getCountryFlag(circuit.country)}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="font-semibold truncate">{circuit.name}</span>
                      <span className="font-mono text-[9px] text-muted-foreground/70 truncate">{circuit.country}, {circuit.city}</span>
                    </div>
                  </div>
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
        </Command>
      </div>
    </div>
  );
}
