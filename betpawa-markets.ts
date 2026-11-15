/**
 * Marchés tennis BetPawa — IDs validés (nov 2026)
 * Endpoint détail : GET /api/sportsbook/v4/events/{eventId}
 *
 * Note lignes : certains handicaps/totaux sont stockés ×4
 * (ex: 90 → 22.5 jeux). On divise par 4 quand marketType le requiert.
 */

export const MARKET_TYPES = {
  MATCH_WINNER: '2043818',
  FIRST_SET_WINNER: '4758',
  SECOND_SET_WINNER: '4770',
  GAME_HANDICAP_MATCH: '3532590',
  TOTAL_GAMES: '4895',
  TOTAL_SETS: '3597899',
  PLAYER_GAMES_HOME: '2068161',
  PLAYER_GAMES_AWAY: '2068172',
  EXACT_SCORE: '4429',
  GAME_HANDICAP_FIRST_SET: '4666923',
  TOTAL_GAMES_FIRST_SET: '4880',
} as const;

/** Types dont la ligne est encodée ×4 */
const LINE_SCALE_4 = new Set<string>([
  MARKET_TYPES.GAME_HANDICAP_MATCH,
  MARKET_TYPES.TOTAL_GAMES,
  MARKET_TYPES.PLAYER_GAMES_HOME,
  MARKET_TYPES.PLAYER_GAMES_AWAY,
  MARKET_TYPES.GAME_HANDICAP_FIRST_SET,
  MARKET_TYPES.TOTAL_GAMES_FIRST_SET,
  MARKET_TYPES.TOTAL_SETS,
]);

export type ParsedPrice = {
  key: string;
  label: string;
  odds: number;
  suspended: boolean;
};

export type ParsedMarket = {
  marketTypeId: string;
  marketName: string;
  line: number | null;
  prices: ParsedPrice[];
};

export type EventMarketsBundle = {
  eventId: string;
  name: string;
  player1Name: string;
  player2Name: string;
  startTime: string | null;
  competition: string;
  markets: ParsedMarket[];
};

function decodeLine(marketTypeId: string, raw: any): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (LINE_SCALE_4.has(marketTypeId)) return n / 4;
  return n;
}

function parsePrices(
  marketTypeId: string,
  prices: any[],
  line: number | null,
  player1Name: string,
  player2Name: string
): ParsedPrice[] {
  const out: ParsedPrice[] = [];
  for (const p of prices || []) {
    const odds = Number(p.odds);
    if (!Number.isFinite(odds) || odds < 1.01) continue;
    const rawName = String(p.displayName || p.name || '');
    let key = rawName.toLowerCase();
    let label = rawName;

    // Normalisation
    if (rawName === '1' || key === '1') {
      key = 'p1';
      label = player1Name;
    } else if (rawName === '2' || key === '2') {
      key = 'p2';
      label = player2Name;
    } else if (/plus de|over/i.test(rawName)) {
      key = line != null ? `over_${line}` : 'over';
      label = line != null ? `Over ${line}` : 'Over';
    } else if (/moins de|under/i.test(rawName)) {
      key = line != null ? `under_${line}` : 'under';
      label = line != null ? `Under ${line}` : 'Under';
    } else if (rawName.includes('{formattedHandicap}')) {
      // handicap sides: first price = home/p1, second = away/p2 typically
      // handled by order below
    }

    out.push({
      key,
      label,
      odds,
      suspended: Boolean(p.suspended),
    });
  }

  // Fix handicap labels when template placeholders
  if (
    marketTypeId === MARKET_TYPES.GAME_HANDICAP_MATCH ||
    marketTypeId === MARKET_TYPES.GAME_HANDICAP_FIRST_SET
  ) {
    if (out.length >= 2 && line != null) {
      const abs = Math.abs(line);
      // Convention: line negative means p1 gives games
      out[0].key = `p1_hcp_${line}`;
      out[0].label = `${player1Name} ${line > 0 ? '+' : ''}${line}`;
      out[1].key = `p2_hcp_${-line}`;
      out[1].label = `${player2Name} ${-line > 0 ? '+' : ''}${-line}`;
    }
  }

  return out.filter((p) => !p.suspended);
}

export async function fetchEventMarkets(
  eventId: string
): Promise<EventMarketsBundle | null> {
  const url = `https://www.betpawa.cm/api/sportsbook/v4/events/${eventId}`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; TennisIntelligenceEngine/0.1)',
        'x-pawa-brand': 'betpawa-cameroon',
        'x-pawa-language': 'fr',
        devicetype: 'web',
      },
      next: { revalidate: 20 },
    });
    if (!res.ok) return null;
    const d = await res.json();
    if (d.error || !d.id) return null;

    const parts = d.participants || [];
    const p1 = parts.find((x: any) => x.position === 1) || parts[0];
    const p2 = parts.find((x: any) => x.position === 2) || parts[1];
    const player1Name = p1?.name || '';
    const player2Name = p2?.name || '';

    const markets: ParsedMarket[] = [];
    for (const m of d.markets || []) {
      const mt = m.marketType || {};
      const marketTypeId = String(mt.id || '');
      const marketName = String(mt.displayName || mt.name || marketTypeId);

      for (const row of m.row || []) {
        const rawLine =
          row.handicap ?? row.line ?? row.total ?? row.name ?? null;
        // sometimes line is only in price additionalInfo — keep row-level
        let line = decodeLine(marketTypeId, rawLine);
        // For total markets, line often sits on the row as number in handicap field
        if (line == null && row.prices?.[0]?.additionalInfo?.handicap != null) {
          line = decodeLine(
            marketTypeId,
            row.prices[0].additionalInfo.handicap
          );
        }

        const prices = parsePrices(
          marketTypeId,
          row.prices || [],
          line,
          player1Name,
          player2Name
        );
        if (prices.length === 0) continue;

        markets.push({
          marketTypeId,
          marketName,
          line,
          prices,
        });
      }
    }

    return {
      eventId: String(d.id),
      name: d.name || '',
      player1Name,
      player2Name,
      startTime: d.startTime || null,
      competition: d.competition?.name || 'Tennis',
      markets,
    };
  } catch {
    return null;
  }
}
