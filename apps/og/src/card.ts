import type { ShareCard, ShareCardRow } from '@/lib/shareImage';
import { SITE_NAME } from '@/lib/site';

// satori takes React-shaped element objects; building them by hand keeps React and JSX out of here.
type Style = Record<string, string | number>;
export type Node = { type: string; props: { style?: Style; children?: Array<Node | string> | Node | string } };

const h = (style: Style, ...children: Array<Node | string>): Node => ({ type: 'div', props: { style: { display: 'flex', ...style }, children } });

const PURPLE = '#a855f7';
const MUTED = '#8a8a8a';

function row({ place, name, detail, color }: ShareCardRow, first: boolean): Node {
  return h(
    { alignItems: 'center', gap: 24, padding: '18px 0', borderTop: first ? 'none' : '1px solid #1f1f1f' },
    h({ width: 64, fontFamily: 'JetBrains Mono', fontSize: 28, color: first ? PURPLE : MUTED }, place),
    h({ width: 8, height: 48, backgroundColor: color }),
    h({ flexGrow: 1, fontSize: 40, fontWeight: 700, color: '#f7f7f7' }, name),
    h({ fontFamily: 'JetBrains Mono', fontSize: 30, color: first ? '#f7f7f7' : MUTED }, detail),
  );
}

// satori sizes boxes content-box, so the padding lives on a flex child rather than the fixed-size root.
export function cardNode(card: ShareCard, width: number, height: number): Node {
  return h(
    { width, height, backgroundColor: '#000', fontFamily: 'Sora', color: '#f7f7f7' },
    h({ width: 12, backgroundColor: PURPLE }),
    content(card),
  );
}

function content(card: ShareCard): Node {
  return h(
    { flexGrow: 1, flexDirection: 'column', padding: '56px 72px 48px 72px' },
    h({ fontFamily: 'JetBrains Mono', fontSize: 22, letterSpacing: 4, textTransform: 'uppercase', color: PURPLE }, card.kicker),
    h({ marginTop: 14, fontSize: 64, fontWeight: 700, lineHeight: 1.05 }, card.title),
    h({ marginTop: 10, fontSize: 26, color: MUTED }, card.subtitle),
    h({ marginTop: 28, flexDirection: 'column' }, ...card.rows.map((r, i) => row(r, i === 0))),
    h({ marginTop: 'auto', justifyContent: 'space-between', fontFamily: 'JetBrains Mono', fontSize: 20, color: MUTED },
      h({}, SITE_NAME.toLowerCase()), h({}, 'f1.gorkemkaryol.dev')),
  );
}
