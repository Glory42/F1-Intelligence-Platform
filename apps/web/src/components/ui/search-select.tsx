import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';

interface Props<T extends { id: number }> {
  items: T[];
  selectedId: number;
  onSelect: (id: number) => void;
  placeholder?: string;
  getInputLabel: (item: T) => string;
  renderOption: (item: T) => ReactNode;
  matches: (item: T, query: string) => boolean;
  noResultsLabel: string;
}

export function SearchSelect<T extends { id: number }>({
  items,
  selectedId,
  onSelect,
  placeholder = 'Search...',
  getInputLabel,
  renderOption,
  matches,
  noResultsLabel,
}: Props<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selectedItem = items.find(item => item.id === selectedId);

  const filtered = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter(item => matches(item, q));
  }, [items, query, matches]);

  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isOpen && selectedItem) {
      setQuery('');
    }
  }, [isOpen, selectedItem]);

  return (
    <div ref={ref} className="relative w-full">
      <div className="relative">
        <input
          type="text"
          value={isOpen ? query : (selectedItem ? getInputLabel(selectedItem) : '')}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className="bg-black border border-white/[0.08] text-white h-9 text-xs font-mono px-3 uppercase tracking-wider focus:outline-none focus:border-[#a855f7]/40 w-full pr-8 cursor-text"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none text-[8px] font-mono select-none">
          {isOpen ? '▲' : '▼'}
        </span>
      </div>

      <div
        aria-hidden={!isOpen}
        className={`absolute left-0 right-0 top-full mt-1 z-50 max-h-60 overflow-y-auto border border-white/[0.08] bg-black shadow-[0_4px_12px_rgba(0,0,0,0.8)] origin-top transition-[opacity,transform] duration-150 ease-spring ${
          isOpen ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none'
        }`}
      >
        {filtered.length > 0 ? (
          filtered.map((item) => {
            const active = item.id === selectedId;
            return (
              <button
                key={item.id}
                tabIndex={isOpen ? 0 : -1}
                onClick={() => {
                  onSelect(item.id);
                  setIsOpen(false);
                  setQuery('');
                }}
                className={`w-full text-left px-3 py-2 font-mono text-[10px] tracking-wider uppercase border-b border-white/[0.03] last:border-b-0 hover:bg-white/[0.04] transition-colors duration-100 ${
                  active ? 'text-[#a855f7] bg-white/[0.02]' : 'text-muted-foreground'
                }`}
              >
                {renderOption(item)}
              </button>
            );
          })
        ) : (
          <div className="px-3 py-2 font-mono text-[9px] text-muted-foreground uppercase tracking-widest text-center">
            {noResultsLabel}
          </div>
        )}
      </div>
    </div>
  );
}
