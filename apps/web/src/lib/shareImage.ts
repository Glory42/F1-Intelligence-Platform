import { getTeamColor } from '@/lib/f1/teamColors';
import type { PredictionResponse, Race, RaceDetailResponse } from '@/types';

// Per-race share images are rendered after the race by a GitHub Action (apps/og) into a public R2
// bucket: Workers Free's 10 ms CPU can't run satori. This module is what both sides agree on.
export type ShareImageKind = 'race' | 'prediction';

export function shareImageKey(kind: ShareImageKind, raceId: number): string {
  return `og/${kind}/${raceId}.png`;
}

// Undefined until the bucket's public URL is configured: BaseLayout then keeps the default image.
export function shareImageUrl(base: string | undefined, kind: ShareImageKind, raceId: number): string | undefined {
  return base ? `${base.replace(/\/+$/, '')}/${shareImageKey(kind, raceId)}` : undefined;
}

const OG_IMAGE_BASE = import.meta.env.PUBLIC_OG_IMAGE_URL;

// The Action only renders a race once it's completed, and a prediction once it exists.
export function raceShareImage(race: Race | null | undefined): string | undefined {
  return race?.status === 'completed' ? shareImageUrl(OG_IMAGE_BASE, 'race', race.id) : undefined;
}

export function predictionShareImage(raceId: number | null | undefined, hasPrediction: boolean): string | undefined {
  return raceId != null && hasPrediction ? shareImageUrl(OG_IMAGE_BASE, 'prediction', raceId) : undefined;
}

export type ShareCardRow = { place: string; name: string; detail: string; color: string };
export type ShareCard = { kicker: string; title: string; subtitle: string; rows: ShareCardRow[] };

function raceKicker(race: Race, what: string): string {
  return `Round ${race.roundNumber} · ${race.raceDate.slice(0, 4)} · ${what}`;
}

export function raceShareCard({ race, results }: RaceDetailResponse): ShareCard | null {
  const podium = results
    .filter((r) => r.finishPosition != null && r.finishPosition <= 3)
    .sort((a, b) => a.finishPosition! - b.finishPosition!);
  if (race.status !== 'completed' || podium.length === 0) return null;
  return {
    kicker: raceKicker(race, 'Result'),
    title: race.name,
    subtitle: `${race.circuit.name} · ${race.circuit.country}`,
    rows: podium.map((r) => ({
      place: `P${r.finishPosition}`,
      name: r.driver.fullName,
      detail: r.driver.team.name,
      color: getTeamColor(r.driver.team.teamKey),
    })),
  };
}

export function predictionShareCard({ race, drivers, modelVersion }: PredictionResponse): ShareCard | null {
  const favourites = [...drivers].sort((a, b) => Number(b.winProbability) - Number(a.winProbability)).slice(0, 3);
  if (favourites.length === 0) return null;
  return {
    kicker: raceKicker(race, 'Prediction'),
    title: race.name,
    subtitle: `Win chances · model ${modelVersion}`,
    rows: favourites.map((d, i) => ({
      place: `P${i + 1}`,
      name: d.driver.fullName,
      detail: `${Math.round(Number(d.winProbability) * 100)}%`,
      color: getTeamColor(d.driver.team.teamKey),
    })),
  };
}
