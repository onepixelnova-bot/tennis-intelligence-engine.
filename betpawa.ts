/**
 * Client minimal BetPawa pour l'API Next.js
 * (miroir de EventCollector — version JS pure)
 */

const BASE = 'https://www.betpawa.cm';
const TENNIS_CATEGORY = '452';
const MONEYLINE = '2043818';

function buildQuery(eventType: 'LIVE' | 'UPCOMING', take = 40) {
  const payload = {
    queries: [
      {
        query: {
          eventType,
          categories: [TENNIS_CATEGORY],
          ...(eventType === 'UPCOMING' ? { hasOdds: true } : {}),
        },
        view: { marketTypes: [MONEYLINE] },
        skip: 0,
        take,
      },
    ],
  };
  return encodeURIComponent(JSON.stringify(payload));
}

export type BetPawaTennisEvent = {
  id: string;
  player1Name: string;
  player2Name: string;
  startTime: string | null;
  isLive: boolean;
  oddsP1: number | null;
  oddsP2: number | null;
  marketName: string;
  tournamentHint: string;
};

function parseBatch(data: any, isLive: boolean): BetPawaTennisEvent[] {
  const out: BetPawaTennisEvent[] = [];
  if (!data?.responses) return out;

  for (const batch of data.responses) {
    for (const raw of batch.responses || []) {
      const parts = raw.participants || [];
      if (parts.length < 2) continue;
      const p1 = parts.find((p: any) => p.position === 1) || parts[0];
      const p2 = parts.find((p: any) => p.position === 2) || parts[1];

      let oddsP1: number | null = null;
      let oddsP2: number | null = null;
      let marketName = 'Vainqueur du Match';

      const market = (raw.markets || [])[0];
      if (market) {
        marketName = market.marketType?.displayName || marketName;
        const prices = market.row?.[0]?.prices || [];
        for (const pr of prices) {
          if (pr.displayName === '1' || pr.name === '1') oddsP1 = pr.odds;
          if (pr.displayName === '2' || pr.name === '2') oddsP2 = pr.odds;
        }
      }

      out.push({
        id: String(raw.id),
        player1Name: p1?.name || '',
        player2Name: p2?.name || '',
        startTime: raw.startTime || null,
        isLive,
        oddsP1,
        oddsP2,
        marketName,
        tournamentHint: raw.name || 'Tennis',
      });
    }
  }
  return out;
}

export async function fetchTennisEvents(): Promise<BetPawaTennisEvent[]> {
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'Mozilla/5.0 (compatible; TennisIntelligenceEngine/0.1)',
    'x-pawa-brand': 'betpawa-cameroon',
    'x-pawa-language': 'fr',
    devicetype: 'web',
  };

  const [liveRes, upRes] = await Promise.all([
    fetch(`${BASE}/api/sportsbook/v4/events/lists/by-queries?q=${buildQuery('LIVE')}`, {
      headers,
      next: { revalidate: 30 },
    }),
    fetch(`${BASE}/api/sportsbook/v4/events/lists/by-queries?q=${buildQuery('UPCOMING')}`, {
      headers,
      next: { revalidate: 30 },
    }),
  ]);

  const liveData = liveRes.ok ? await liveRes.json() : null;
  const upData = upRes.ok ? await upRes.json() : null;

  return [...parseBatch(liveData, true), ...parseBatch(upData, false)];
}

function norm(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function overlap(a: string, b: string) {
  const ta = new Set(norm(a).split(' ').filter(Boolean));
  const tb = new Set(norm(b).split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

export function matchPlayers(
  events: BetPawaTennisEvent[],
  input1: string,
  input2: string
): Array<BetPawaTennisEvent & { score: number }> {
  const scored: Array<BetPawaTennisEvent & { score: number }> = [];
  for (const ev of events) {
    const s1 =
      Math.max(overlap(input1, ev.player1Name), overlap(input1, ev.player2Name));
    const s2 =
      Math.max(overlap(input2, ev.player1Name), overlap(input2, ev.player2Name));
    if (s1 >= 0.4 && s2 >= 0.4) {
      scored.push({ ...ev, score: (s1 + s2) / 2 });
    }
  }
  return scored.sort((a, b) => b.score - a.score);
}
