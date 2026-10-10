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

export function initRaceTabs(tablist: HTMLElement): void {
  const namespace = tablist.dataset.namespace ?? '';
  const activeStyle = tablist.dataset.activeStyle ?? '';
  const btns = Array.from(tablist.querySelectorAll<HTMLButtonElement>('.race-tab-btn'));
  const panelIds = new Set(btns.map((b) => `${namespace}panel-${b.dataset.tab}`));

  const activate = (target: string) => {
    btns.forEach((b) => {
      const active = b.dataset.tab === target;
      b.setAttribute('aria-selected', String(active));
      b.tabIndex = active ? 0 : -1;
      b.setAttribute('style', active ? activeStyle : '');
    });
    panelIds.forEach((panelId) => {
      document.getElementById(panelId)?.classList.toggle('hidden', panelId !== `${namespace}panel-${target}`);
    });
  };

  btns.forEach((btn, i) => {
    btn.addEventListener('click', () => activate(btn.dataset.tab!));
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const next = btns[e.key === 'ArrowRight' ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length];
      next.focus();
      activate(next.dataset.tab!);
    });
  });
}
