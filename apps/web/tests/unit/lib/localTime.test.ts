// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { formatLocal, formatUtc, hasTime, isLocalTimeFormat, localiseTimes } from '@/lib/localTime';

// Las Vegas 2025: Saturday night on the Strip is already Sunday in UTC.
const VEGAS_START = '2025-11-23T04:00:00.000Z';

describe('formatUtc', () => {
  test('labels server-rendered times as UTC so a visitor without JS knows the zone', () => {
    expect(formatUtc(VEGAS_START, 'session')).toBe('Sun 04:00 UTC');
    expect(formatUtc(VEGAS_START, 'datetime')).toBe('23 November 2025 at 04:00 UTC');
  });

  test('leaves a plain day unlabelled', () => {
    expect(formatUtc('2025-11-22', 'date')).toBe('22 November 2025');
  });
});

describe('formatLocal', () => {
  test("moves the instant into the visitor's zone, day included", () => {
    expect(formatLocal(VEGAS_START, 'session', 'en-GB', 'America/Los_Angeles')).toBe('Sat 20:00');
    expect(formatLocal(VEGAS_START, 'date', 'en-GB', 'America/Los_Angeles')).toBe('22 November 2025');
  });

  test('names the zone on a full date and time', () => {
    expect(formatLocal(VEGAS_START, 'datetime', 'en-GB', 'Asia/Tokyo')).toBe('23 November 2025 at 13:00 GMT+9');
  });
});

describe('hasTime', () => {
  test('tells an instant from a calendar day', () => {
    expect(hasTime(VEGAS_START)).toBe(true);
    expect(hasTime('2025-11-22')).toBe(false);
  });
});

describe('localiseTimes', () => {
  test('rewrites every marked time and leaves the rest alone', () => {
    document.body.innerHTML = `
      <time datetime="${VEGAS_START}" data-local-time="session">Sun 04:00 UTC</time>
      <time datetime="2025-11-22">22 November 2025</time>
      <time datetime="${VEGAS_START}" data-local-time="nonsense">kept</time>`;

    localiseTimes(document);

    const [session, day, unknown] = document.querySelectorAll('time');
    expect(session.textContent).toBe(formatLocal(VEGAS_START, 'session'));
    expect(day.textContent).toBe('22 November 2025');
    expect(unknown.textContent).toBe('kept');
  });

  test('knows only its own formats', () => {
    expect([isLocalTimeFormat('date'), isLocalTimeFormat('nonsense'), isLocalTimeFormat(undefined)]).toEqual([true, false, false]);
  });
});
