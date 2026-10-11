// `drivers` rows are season-scoped, so one person has a row per season — and the name FastF1 gave
// that season can differ (accents in the Ergast era, "Andrea Kimi Antonelli" in 2025 only).
export interface DriverName {
  code: string;
  firstName: string;
  lastName: string;
}

// Unlike f1db-match.helpers' normalizePersonName this keeps "Jr.", so Piquet Sr. and Jr. stay two people.
export function personKey(d: Pick<DriverName, 'firstName' | 'lastName'>): string {
  const ascii = `${d.firstName} ${d.lastName}`.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  return ascii.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function isSamePerson(a: DriverName, b: DriverName): boolean {
  const ka = personKey(a);
  const kb = personKey(b);
  if (ka === kb) return true;
  return a.code === b.code && (ka.endsWith(` ${kb}`) || kb.endsWith(` ${ka}`));
}
