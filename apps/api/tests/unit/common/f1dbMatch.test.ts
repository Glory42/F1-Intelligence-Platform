import { describe, expect, it } from 'bun:test';
import { f1dbConstructorId, normalizePersonName } from '../../../src/common/f1dbMatch';

describe('normalizePersonName', () => {
  it('produces the same key as data-engine for core and F1DB spellings', () => {
    expect(['Sergio Pérez', 'Nico Hülkenberg', 'Kimi Räikkönen', 'Carlos Sainz Jr.', '  Max   Verstappen '].map(normalizePersonName))
      .toEqual(['sergio perez', 'nico hulkenberg', 'kimi raikkonen', 'carlos sainz', 'max verstappen']);
  });
});

describe('f1dbConstructorId', () => {
  it('maps core team keys onto F1DB constructor ids, including the renamed entries', () => {
    expect(['ferrari', 'aston_martin', 'red_bull_racing', 'haas_f1_team', 'alfa_romeo_racing', 'manor_marussia'].map(f1dbConstructorId))
      .toEqual(['ferrari', 'aston-martin', 'red-bull', 'haas', 'alfa-romeo', 'manor']);
  });
});
