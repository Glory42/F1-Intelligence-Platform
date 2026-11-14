import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { predictionShareCard, raceShareCard, shareImageKey, shareImageUrl, type ShareCard, type ShareImageKind } from '@/lib/shareImage';
import type { PredictionHistoryItem, PredictionResponse, Race, RaceDetailResponse } from '@/types';
import { renderCard } from './render';

// Reads only the public API, whose answers are edge- and R2-cached: no Neon connection from here.
const API_URL = process.env.API_URL ?? 'https://f1-api.gorkemkaryol.dev';
const PUBLIC_URL = process.env.OG_PUBLIC_URL || undefined;
const OUT_DIR = process.env.OG_OUT_DIR ?? 'out';
const YEAR = Number(process.env.OG_YEAR || new Date().getUTCFullYear());
const FORCE = process.env.OG_FORCE === 'true';

type Job = { kind: ShareImageKind; raceId: number };

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return ((await res.json()) as { data: T }).data;
}

// A rendered image never changes (a result is final; a prediction is fixed after qualifying), so
// anything already in the bucket is skipped and a run after the first costs a few HEAD requests.
async function published(job: Job): Promise<boolean> {
  const url = shareImageUrl(PUBLIC_URL, job.kind, job.raceId);
  if (!url || FORCE) return false;
  return (await fetch(url, { method: 'HEAD' })).ok;
}

async function cardFor({ kind, raceId }: Job): Promise<ShareCard | null> {
  return kind === 'race'
    ? raceShareCard(await api<RaceDetailResponse>(`/api/races/${raceId}`))
    : predictionShareCard(await api<PredictionResponse>(`/api/predictions/race/${raceId}`));
}

async function main(): Promise<void> {
  const [races, predictions] = await Promise.all([
    api<Race[]>(`/api/races?year=${YEAR}`),
    api<PredictionHistoryItem[]>(`/api/predictions/history?year=${YEAR}`),
  ]);
  const jobs: Job[] = [
    ...races.filter((r) => r.status === 'completed').map((r) => ({ kind: 'race' as const, raceId: r.id })),
    ...predictions.map((p) => ({ kind: 'prediction' as const, raceId: p.raceId })),
  ];
  let rendered = 0;
  let failed = 0;
  // One bad race must not hold back the rest: each image fails on its own and the run reports it.
  for (const job of jobs) {
    try {
      if (await published(job)) continue;
      const card = await cardFor(job);
      if (!card) continue;
      const file = join(OUT_DIR, shareImageKey(job.kind, job.raceId));
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, await renderCard(card));
      rendered += 1;
      console.log(JSON.stringify({ job: 'og_images', kind: job.kind, race_id: job.raceId, status: 'rendered' }));
    } catch (error) {
      failed += 1;
      console.error(JSON.stringify({ job: 'og_images', kind: job.kind, race_id: job.raceId, status: 'failed', error: String(error) }));
    }
  }
  console.log(JSON.stringify({ job: 'og_images', year: YEAR, candidates: jobs.length, rendered, failed, status: 'done' }));
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ job: 'og_images', status: 'failed', error: String(error) }));
  process.exit(1);
});
