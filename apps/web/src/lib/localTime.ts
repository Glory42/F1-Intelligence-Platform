export type LocalTimeFormat = 'session' | 'datetime' | 'date';

const FORMATS: Record<LocalTimeFormat, Intl.DateTimeFormatOptions> = {
  session: { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  datetime: { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  date: { day: 'numeric', month: 'long', year: 'numeric' },
};

const LOCAL_ZONE_LABEL: Partial<Record<LocalTimeFormat, Intl.DateTimeFormatOptions>> = {
  datetime: { timeZoneName: 'short' },
};

export function isLocalTimeFormat(value: string | undefined): value is LocalTimeFormat {
  return value !== undefined && value in FORMATS;
}

// A bare YYYY-MM-DD is a calendar day with no instant behind it: shifting it by timezone would move the day.
export function hasTime(iso: string): boolean {
  return iso.includes('T');
}

// What the server renders (and a visitor without JS keeps): the instant in UTC, labelled so.
export function formatUtc(iso: string, format: LocalTimeFormat): string {
  const text = new Intl.DateTimeFormat('en-GB', { ...FORMATS[format], timeZone: 'UTC' }).format(new Date(iso));
  return format === 'date' ? text : `${text} UTC`;
}

export function formatLocal(iso: string, format: LocalTimeFormat, locale?: string, timeZone?: string): string {
  const options = { ...FORMATS[format], ...LOCAL_ZONE_LABEL[format], timeZone };
  return new Intl.DateTimeFormat(locale, options).format(new Date(iso));
}

export function localiseTimes(root: ParentNode): void {
  root.querySelectorAll<HTMLTimeElement>('time[data-local-time]').forEach((el) => {
    const format = el.dataset.localTime;
    if (isLocalTimeFormat(format)) el.textContent = formatLocal(el.dateTime, format);
  });
}
