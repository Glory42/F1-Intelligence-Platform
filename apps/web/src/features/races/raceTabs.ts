let countdownTimer: ReturnType<typeof setInterval> | null = null;

export function initRaceCountdown(elementId: string, dateDataKey: string, digitClass: string): void {
  if (countdownTimer) clearInterval(countdownTimer);
  const el = document.getElementById(elementId);
  if (!el) return;
  const raw = el.dataset[dateDataKey] ?? '';
  const target = new Date(raw.includes('T') ? raw : `${raw}T00:00:00`);
  const digits = document.querySelectorAll<HTMLElement>(`.${digitClass}`);

  const tick = () => {
    if (isNaN(target.getTime()) || digits.length < 4) return;
    const diff = target.getTime() - Date.now();
    if (diff <= 0) {
      digits.forEach((d) => (d.textContent = '00'));
      return;
    }
    const vals = [
      Math.floor(diff / 86400000),
      Math.floor((diff % 86400000) / 3600000),
      Math.floor((diff % 3600000) / 60000),
      Math.floor((diff % 60000) / 1000),
    ];
    digits.forEach((d, i) => (d.textContent = String(vals[i]).padStart(2, '0')));
  };

  tick();
  countdownTimer = setInterval(tick, 1000);
}

const ACTIVE_TAB_STYLE = 'color:hsl(var(--foreground))';

function moveIndicator(indicator: HTMLElement, tab: HTMLElement, animate: boolean): void {
  if (!animate) indicator.style.transition = 'none';
  indicator.style.width = `${tab.offsetWidth}px`;
  indicator.style.transform = `translateX(${tab.offsetLeft}px)`;
  indicator.style.opacity = '1';
  if (!animate) {
    void indicator.offsetWidth;
    indicator.style.transition = '';
  }
}

export function initRaceTabs(tablist: HTMLElement): void {
  const namespace = tablist.dataset.namespace ?? '';
  const btns = Array.from(tablist.querySelectorAll<HTMLButtonElement>('.race-tab-btn'));
  const panelIds = new Set(btns.map((b) => `${namespace}panel-${b.dataset.tab}`));
  const indicator = tablist.querySelector<HTMLElement>('[data-tab-indicator]');
  let current = btns.find((b) => b.getAttribute('aria-selected') === 'true') ?? btns[0];

  // The server underlines the default tab with its own border; once JS runs the sliding indicator takes over.
  const paint = () => btns.forEach((b) => b.setAttribute('style', b === current ? ACTIVE_TAB_STYLE : ''));

  const activate = (btn: HTMLButtonElement) => {
    if (btn === current) return;
    current = btn;
    btns.forEach((b) => {
      const active = b === btn;
      b.setAttribute('aria-selected', String(active));
      b.tabIndex = active ? 0 : -1;
    });
    paint();
    panelIds.forEach((panelId) => {
      const panel = document.getElementById(panelId);
      if (!panel) return;
      const shown = panelId === `${namespace}panel-${btn.dataset.tab}`;
      panel.classList.toggle('hidden', !shown);
      panel.classList.remove('tab-panel-enter');
      if (shown) {
        void panel.offsetWidth;
        panel.classList.add('tab-panel-enter');
      }
    });
    if (indicator) moveIndicator(indicator, btn, true);
    btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  if (indicator && current) {
    paint();
    moveIndicator(indicator, current, false);
    new ResizeObserver(() => moveIndicator(indicator, current, false)).observe(tablist);
  }

  btns.forEach((btn, i) => {
    btn.addEventListener('click', () => activate(btn));
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const next = btns[e.key === 'ArrowRight' ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length];
      next.focus();
      activate(next);
    });
  });
}
