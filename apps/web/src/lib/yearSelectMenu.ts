// The client router skips an inline script whose text already ran this session, so a cached page seen again
// came back with a dead year menu. This runs from one bundled script on every astro:page-load instead.
type Menu = { button: HTMLElement; panel: HTMLElement; arrow: HTMLElement | null };

const menus = new Set<Menu>();

function setOpen({ button, panel, arrow }: Menu, open: boolean): void {
  panel.classList.toggle('hidden', !open);
  button.setAttribute('aria-expanded', String(open));
  if (arrow) arrow.style.transform = open ? 'rotate(180deg)' : '';
}

function closeAll(): void {
  for (const menu of menus) {
    if (menu.panel.isConnected) setOpen(menu, false);
    else menus.delete(menu);
  }
}

let listening = false;

export function initYearSelects(root: ParentNode = document): void {
  if (!listening) {
    document.addEventListener('click', closeAll);
    listening = true;
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-year-select]')) {
    if (el.dataset.yearSelectReady) continue;
    const button = el.querySelector<HTMLElement>('[data-year-select-button]');
    const panel = el.querySelector<HTMLElement>('[data-year-select-panel]');
    if (!button || !panel) continue;
    el.dataset.yearSelectReady = 'true';
    const menu: Menu = { button, panel, arrow: el.querySelector<HTMLElement>('[data-year-select-arrow]') };
    menus.add(menu);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      setOpen(menu, panel.classList.contains('hidden'));
    });
  }
}
