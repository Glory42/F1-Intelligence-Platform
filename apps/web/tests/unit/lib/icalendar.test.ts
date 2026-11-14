import { describe, expect, test } from 'vitest';
import { foldLine, serializeCalendar, type CalendarEvent } from '@/lib/icalendar';

const STAMP = new Date('2026-11-14T09:30:00.000Z');
const qualifying: CalendarEvent = {
  uid: 'race-7-qualifying@f1.example',
  summary: 'Italian Grand Prix: Qualifying',
  start: new Date('2025-09-06T14:00:00.000Z'),
  durationMinutes: 60,
  location: 'Autodromo Nazionale Monza, Monza, Italy',
  url: 'https://f1.example/races/7',
};

const octets = (line: string) => new TextEncoder().encode(line).length;

describe('serializeCalendar', () => {
  const ics = serializeCalendar({ name: 'F1 sessions', events: [qualifying], stampedAt: STAMP });
  const lines = ics.split('\r\n');

  test('ends every line with CRLF and nothing bare', () => {
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  test('writes an event with UTC start, end and stamp', () => {
    expect(lines).toEqual(expect.arrayContaining([
      'BEGIN:VEVENT',
      'UID:race-7-qualifying@f1.example',
      'DTSTAMP:20261114T093000Z',
      'DTSTART:20250906T140000Z',
      'DTEND:20250906T150000Z',
      'URL:https://f1.example/races/7',
      'END:VEVENT',
    ]));
    expect(lines.slice(0, 2)).toEqual(['BEGIN:VCALENDAR', 'VERSION:2.0']);
  });

  test('escapes commas, semicolons and backslashes in text', () => {
    expect(lines).toContain('LOCATION:Autodromo Nazionale Monza\\, Monza\\, Italy');
    const odd = serializeCalendar({ name: 'a;b\\c', events: [], stampedAt: STAMP });
    expect(odd).toContain(String.raw`X-WR-CALNAME:a\;b\\c` + '\r\n');
  });

  test('renders the same feed twice for the same input', () => {
    expect(serializeCalendar({ name: 'F1 sessions', events: [qualifying], stampedAt: STAMP })).toBe(ics);
  });
});

describe('foldLine', () => {
  test('leaves a line of 75 octets alone', () => {
    const line = `SUMMARY:${'x'.repeat(67)}`;
    expect(octets(line)).toBe(75);
    expect(foldLine(line)).toBe(line);
  });

  test('folds long lines at 75 octets with a leading space on each continuation', () => {
    const line = `SUMMARY:${'x'.repeat(200)}`;
    const folded = foldLine(line).split('\r\n');

    expect(folded.every((part) => octets(part) <= 75)).toBe(true);
    expect(folded.slice(1).every((part) => part.startsWith(' '))).toBe(true);
    expect(folded.map((part, i) => (i === 0 ? part : part.slice(1))).join('')).toBe(line);
  });

  test('never splits a multi-byte character', () => {
    const line = `LOCATION:${'São Paulo, Interlagos, '.repeat(6)}`;
    const folded = foldLine(line).split('\r\n');

    expect(folded.every((part) => octets(part) <= 75)).toBe(true);
    expect(folded.map((part, i) => (i === 0 ? part : part.slice(1))).join('')).toBe(line);
  });
});
