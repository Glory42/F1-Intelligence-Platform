// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TitleWhatIf } from '@/features/standings/components/TitleWhatIf';

const weekends = [
  { round: 23, name: 'Qatar Grand Prix', grandPrix: true, sprint: true },
  { round: 24, name: 'Abu Dhabi Grand Prix', grandPrix: true, sprint: false },
];
const contenders = [
  { id: 1, name: 'Verstappen', points: 400, finishes: [8] },
  { id: 4, name: 'Norris', points: 380, finishes: [6] },
];
const drivers = [{ id: 1, code: 'VER', color: '#3671C6' }, { id: 4, code: 'NOR', color: '#FF8000' }];

function renderWhatIf() {
  render(<TitleWhatIf year={2025} weekends={weekends} contenders={contenders} drivers={drivers} />);
  const pick = (label: string, place: string) => fireEvent.change(screen.getByRole('combobox', { name: label }), { target: { value: place } });
  return { pick };
}

afterEach(cleanup);

describe('TitleWhatIf', () => {
  it('asks for picks first, then names the round the picked results settle the title', () => {
    const { pick } = renderWhatIf();

    expect(screen.getByRole('status')).toHaveTextContent('Pick a few places');

    pick('VER, Qatar Grand Prix sprint', '1');
    pick('VER, Qatar Grand Prix grand prix', '1');

    expect(screen.getByRole('status')).toHaveTextContent('Verstappen takes the title at the Qatar Grand Prix.');
    const standings = within(screen.getByRole('list', { name: 'Standings after these results' }));
    expect(standings.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['1Verstappen433', '2Norris380']);
  });

  it("won't let two drivers share a place in one session", () => {
    const { pick } = renderWhatIf();

    pick('VER, Abu Dhabi Grand Prix grand prix', '1');

    const norris = screen.getByRole('combobox', { name: 'NOR, Abu Dhabi Grand Prix grand prix' });
    expect(within(norris).getByRole('option', { name: 'P1' })).toBeDisabled();
  });

  it('only offers a sprint where one is still to run', () => {
    renderWhatIf();

    expect(screen.queryByRole('combobox', { name: 'VER, Abu Dhabi Grand Prix sprint' })).not.toBeInTheDocument();
  });
});
