import { describe, expect, it } from 'vitest';
import { winnerFacts } from '@/features/circuits/winnerFacts';

// Driver rows are per season, so the same person carries a different id each year.
const win = (year: number, fullName: string, id = year) => ({ year, winner: { id, fullName } });

describe('winnerFacts', () => {
  it('counts races, different winners and the longest run of consecutive wins by one driver', () => {
    const facts = winnerFacts([
      win(2026, 'George Russell'), win(2025, 'Lando Norris'), win(2024, 'Max Verstappen'),
      win(2023, 'Max Verstappen'), win(2022, 'Max Verstappen'), win(2019, 'Lewis Hamilton'),
      { year: 2018, winner: null },
    ]);

    expect(facts.races).toBe(6);
    expect(facts.differentWinners).toBe(4);
    expect(facts.longestStreak).toEqual({ fullName: 'Max Verstappen', wins: 3, fromYear: 2022, toYear: 2024 });
  });

  it('has no streak worth showing when nobody won twice in a row', () => {
    expect(winnerFacts([win(2025, 'A B'), win(2024, 'C D')]).longestStreak).toBeNull();
  });
});

describe('winnerFacts on a tie', () => {
  it('prefers the most recent streak', () => {
    const facts = winnerFacts([win(2018, 'Lewis Hamilton'), win(2017, 'Lewis Hamilton'), win(2023, 'Max Verstappen'), win(2022, 'Max Verstappen')]);
    expect(facts.longestStreak?.fullName).toBe('Max Verstappen');
  });
});
