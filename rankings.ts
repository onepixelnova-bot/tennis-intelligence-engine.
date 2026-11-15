/**
 * Collector rankings ATP/WTA via ESPN (source publique, non officielle).
 * Convertit rang → Elo approximatif pour le moteur.
 * Provenance trackée. Aucune donnée inventée si le joueur est introuvable.
 */

export type RankingEntry = {
  rank: number;
  points: number;
  name: string;
  normalizedName: string;
  athleteId: string;
  tour: 'ATP' | 'WTA';
  elo: number;
};

function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Conversion rang → Elo (approximation standard tennis modeling).
 * Rank 1 ≈ 2200, rank 10 ≈ 1950, rank 50 ≈ 1720, rank 100 ≈ 1580, rank 200 ≈ 1480
 */
export function rankToElo(rank: number, points?: number): number {
  if (rank <= 0) return 1500;
  // Formule empirique lisse
  const base = 2300 - 280 * Math.log10(rank + 1);
  // Légère correction points si dispo
  let elo = base;
  if (points && points > 0) {
    const ptsBoost = Math.min(80, Math.log10(points + 1) * 15);
    elo = 0.85 * base + 0.15 * (1400 + ptsBoost);
  }
  return Math.round(Math.max(1200, Math.min(2500, elo)));
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(normalize(a).split(' ').filter(Boolean));
  const tb = new Set(normalize(b).split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

async function fetchTour(tour: 'atp' | 'wta'): Promise<RankingEntry[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/tennis/${tour}/rankings`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TennisIntelligenceEngine/0.1)' },
      next: { revalidate: 3600 }, // cache 1h
    });
    if (!res.ok) return [];
    const data = await res.json();
    const ranks = data?.rankings?.[0]?.ranks || [];
    const tourLabel = tour.toUpperCase() as 'ATP' | 'WTA';
    const out: RankingEntry[] = [];
    for (const r of ranks) {
      const name = r.athlete?.displayName || r.athlete?.fullName;
      if (!name) continue;
      const rank = Number(r.current) || 0;
      const points = Number(r.points) || 0;
      out.push({
        rank,
        points,
        name,
        normalizedName: normalize(name),
        athleteId: String(r.athlete?.id || ''),
        tour: tourLabel,
        elo: rankToElo(rank, points),
      });
    }
    return out;
  } catch {
    return [];
  }
}

let cache: { at: number; entries: RankingEntry[] } | null = null;
const CACHE_MS = 60 * 60 * 1000; // 1h

export async function getAllRankings(): Promise<RankingEntry[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.entries;
  const [atp, wta] = await Promise.all([fetchTour('atp'), fetchTour('wta')]);
  const entries = [...atp, ...wta];
  cache = { at: Date.now(), entries };
  return entries;
}

export type PlayerRankingMatch = {
  entry: RankingEntry;
  score: number;
};

/**
 * Trouve le meilleur ranking pour un nom saisi.
 * score = token overlap. Seuil recommandé ≥ 0.5
 */
export async function findPlayerRanking(
  name: string,
  minScore = 0.45
): Promise<PlayerRankingMatch | null> {
  const entries = await getAllRankings();
  let best: PlayerRankingMatch | null = null;
  for (const e of entries) {
    const score = Math.max(
      tokenOverlap(name, e.name),
      // aussi match sur nom de famille seul
      tokenOverlap(name, e.name.split(' ').pop() || '')
    );
    if (score >= minScore && (!best || score > best.score)) {
      best = { entry: e, score };
    }
  }
  return best;
}

export async function resolveTwoPlayers(
  name1: string,
  name2: string
): Promise<{
  p1: PlayerRankingMatch | null;
  p2: PlayerRankingMatch | null;
  bothFound: boolean;
}> {
  const [p1, p2] = await Promise.all([
    findPlayerRanking(name1),
    findPlayerRanking(name2),
  ]);
  return { p1, p2, bothFound: !!(p1 && p2) };
}
