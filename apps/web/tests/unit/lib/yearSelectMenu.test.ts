// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from 'vitest';
import { initYearSelects } from '../../../src/lib/yearSelectMenu';

const MENU = `
  <div data-year-select>
    <button type="button" data-year-select-button aria-expanded="false">2023<span data-year-select-arrow>▾</span></button>
    <div data-year-select-panel class="hidden"><a href="?year=2022">2022</a></div>
  </div>`;

const panel = () => document.querySelector<HTMLElement>('[data-year-select-panel]')!;
const button = () => document.querySelector<HTMLButtonElement>('[data-year-select-button]')!;
const isOpen = () => !panel().classList.contains('hidden');

describe('initYearSelects', () => {
  beforeEach(() => {
    document.body.innerHTML = MENU;
  });

  test('the button opens the menu and a second click closes it', () => {
    initYearSelects();

    button().click();
    expect(isOpen()).toBe(true);
    expect(button().getAttribute('aria-expanded')).toBe('true');

    button().click();
    expect(isOpen()).toBe(false);
    expect(button().getAttribute('aria-expanded')).toBe('false');
  });

  test('a click anywhere else closes it', () => {
    initYearSelects();
    button().click();

    document.body.click();

    expect(isOpen()).toBe(false);
  });

  test('wiring the same page twice leaves one handler, so a click still opens it', () => {
    initYearSelects();
    initYearSelects();

    button().click();

    expect(isOpen()).toBe(true);
  });

  // The client router swaps in fresh markup on every navigation, including a cached page seen before.
  test('a page swapped in after navigation is wired again', () => {
    initYearSelects();
    document.body.innerHTML = MENU;

    initYearSelects();
    button().click();

    expect(isOpen()).toBe(true);
  });
});
