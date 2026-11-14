import { readFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import type { ShareCard } from '@/lib/shareImage';
import { cardNode } from './card';

export const WIDTH = 1200;
export const HEIGHT = 630;

const fontFile = (pkg: string, file: string) => readFile(new URL(`../node_modules/@fontsource/${pkg}/files/${file}`, import.meta.url));

// WOFF, not WOFF2: satori can't read WOFF2. latin-ext covers names like Hülkenberg's and Pérez's.
async function loadFonts() {
  const [sora400, sora700, sora400ext, sora700ext, mono, monoExt] = await Promise.all([
    fontFile('sora', 'sora-latin-400-normal.woff'), fontFile('sora', 'sora-latin-700-normal.woff'),
    fontFile('sora', 'sora-latin-ext-400-normal.woff'), fontFile('sora', 'sora-latin-ext-700-normal.woff'),
    fontFile('jetbrains-mono', 'jetbrains-mono-latin-500-normal.woff'),
    fontFile('jetbrains-mono', 'jetbrains-mono-latin-ext-500-normal.woff'),
  ]);
  return [
    { name: 'Sora', data: sora400, weight: 400 as const }, { name: 'Sora', data: sora700, weight: 700 as const },
    { name: 'Sora', data: sora400ext, weight: 400 as const }, { name: 'Sora', data: sora700ext, weight: 700 as const },
    { name: 'JetBrains Mono', data: mono, weight: 500 as const }, { name: 'JetBrains Mono', data: monoExt, weight: 500 as const },
  ];
}

let fonts: Awaited<ReturnType<typeof loadFonts>> | null = null;

export async function renderCard(card: ShareCard): Promise<Buffer> {
  fonts ??= await loadFonts();
  // satori's types want a ReactNode; the plain element objects are exactly that shape.
  const svg = await satori(cardNode(card, WIDTH, HEIGHT) as unknown as Parameters<typeof satori>[0], { width: WIDTH, height: HEIGHT, fonts });
  return new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng();
}
