interface WinnerEntry {
  year: number;
  winner: { fullName: string } | null;
}

export interface WinningStreak {
  fullName: string;
  wins: number;
  fromYear: number;
  toYear: number;
}

export interface WinnerFacts {
  races: number;
  differentWinners: number;
  longestStreak: WinningStreak | null;
}

// Driver ids are season-scoped, so the same person is matched across years by name.
// On a tie the most recent streak wins.
export function winnerFacts(history: WinnerEntry[]): WinnerFacts {
  const won = history.filter((h) => h.winner != null).sort((a, b) => a.year - b.year);
  let best = null as WinningStreak | null;
  let current = null as WinningStreak | null;
  for (const h of won) {
    const name = h.winner!.fullName;
    if (current && current.fullName === name) {
      current = { ...current, wins: current.wins + 1, toYear: h.year };
    } else {
      current = { fullName: name, wins: 1, fromYear: h.year, toYear: h.year };
    }
    if (current.wins >= 2 && (!best || current.wins >= best.wins)) best = current;
  }
  return {
    races: won.length,
    differentWinners: new Set(won.map((h) => h.winner!.fullName)).size,
    longestStreak: best,
  };
}
