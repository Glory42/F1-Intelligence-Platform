import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { constructorKey, f1dbConstructorId, f1dbPersonKey, isSamePerson, personKey } from '../../../src/common/identity';

type DriverTuple = [code: string, firstName: string, lastName: string];

interface IdentityCases {
  people: Array<{ firstName: string; lastName: string; personKey: string; f1dbPersonKey: string }>;
  samePerson: Array<{ a: DriverTuple; b: DriverTuple; same: boolean }>;
  sameConstructor: string[][];
  distinctConstructors: [string, string][];
  f1dbConstructorIds: Record<string, string>;
}

// Shared with data-engine/tests/test_f1db.py, so both sides agree on every key.
const cases = JSON.parse(
  readFileSync(join(import.meta.dir, '../../../../../docs/identity-cases.json'), 'utf8'),
) as IdentityCases;

const driver = ([code, firstName, lastName]: DriverTuple) => ({ code, firstName, lastName });

describe('personKey', () => {
  it.each(cases.people)('keys $firstName $lastName as one person across spellings', (c) => {
    expect(personKey(c)).toBe(c.personKey);
  });
});

describe('f1dbPersonKey', () => {
  it.each(cases.people)('joins $firstName $lastName to the F1DB spelling', (c) => {
    expect(f1dbPersonKey(`${c.firstName} ${c.lastName}`)).toBe(c.f1dbPersonKey);
  });
});

describe('isSamePerson', () => {
  it.each(cases.samePerson)('decides $a vs $b: same = $same', ({ a, b, same }) => {
    expect(isSamePerson(driver(a), driver(b))).toBe(same);
  });
});

describe('constructorKey', () => {
  it.each(cases.sameConstructor)('keeps one outfit together across its rebrands (%s, …)', (...keys) => {
    expect(new Set(keys.map(constructorKey)).size).toBe(1);
  });

  it.each(cases.distinctConstructors)('keeps %s and %s apart', (a, b) => {
    expect(constructorKey(a)).not.toBe(constructorKey(b));
  });

  it('leaves a key it has no lineage for as it is', () => {
    expect(constructorKey('williams')).toBe('williams');
  });
});

describe('f1dbConstructorId', () => {
  it.each(Object.entries(cases.f1dbConstructorIds))('maps core team key %s to F1DB constructor %s', (teamKey, f1dbId) => {
    expect(f1dbConstructorId(teamKey)).toBe(f1dbId);
  });
});
