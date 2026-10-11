import type { ReactNode } from 'react';
import { Shield, User } from 'lucide-react';
import { CompareSlotBadge } from './CompareSlotBadge';

interface Props {
  slot: 'A' | 'B';
  entityType: 'driver' | 'team';
  href: string;
  imageUrl: string | null;
  imageAlt: string;
  borderColor: string;
  name: string;
  subtitle: ReactNode;
  flag?: ReactNode;
}

export function CompareEntityCard({ slot, entityType, href, imageUrl, imageAlt, borderColor, name, subtitle, flag }: Props) {
  const isDriver = entityType === 'driver';

  return (
    <a
      href={href}
      className="group border border-white/[0.06] bg-black hover:border-white/[0.12] hover:shadow-[0_0_15px_rgba(255,255,255,0.015)] p-4 flex items-center justify-between gap-3 transition-all duration-300 transform hover:-translate-y-0.5"
      style={{ borderLeft: `3px solid ${borderColor}` }}
    >
      <div className="flex items-center gap-4 min-w-0">
        <div
          className={
            isDriver
              ? 'w-14 h-14 border border-white/[0.08] bg-white/[0.01] flex items-end justify-center shrink-0 overflow-hidden'
              : 'w-14 h-14 border border-white/[0.08] bg-white/[0.02] flex items-center justify-center shrink-0 p-1'
          }
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={imageAlt}
              className={isDriver ? 'w-full h-full object-cover object-top' : 'max-w-full max-h-full object-contain'}
            />
          ) : isDriver ? (
            <User size={32} className="text-white/20 mb-1" />
          ) : (
            <Shield size={28} className="text-white/20" />
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CompareSlotBadge slot={slot} color={borderColor} />
            <h3 className="text-base font-bold text-white leading-tight truncate group-hover:text-[#a855f7] transition-colors">{name}</h3>
          </div>
          {subtitle}
        </div>
      </div>
      {flag}
    </a>
  );
}
