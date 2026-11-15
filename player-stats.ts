/**
 * Stats joueurs avancées — forme récente, H2H, indices surface.
 * Source : ESPN scoreboard ATP/WTA (résultats STATUS_FINAL).
 * Aucune statistique inventée : si données absentes → null / reliability basse.
 */

export type RecentMatch = {
  date: string;
  won: boolean;
  opponent: string;
  scoreText?: string;
  eventName?: string;
  surface?: "hard" | "clay" | "grass" | "unknown";
};

export type FormSnapshot = {
  last5: { played: number; won: number; winPct: number };
  last10: { played: number; won: number; winPct: number };
  last20: { played: number; won: number; winPct: number };
  reliability: number;
  source: string;
  asOf: string;
  matches: RecentMatch[];
};

export type H2HSnapshot = {
  total: number;
  p1Wins: number;
  p2Wins: number;
  recent: RecentMatch[];
  reliability: number;
};

export type PlayerStatsBundle = {
  formP1: FormSnapshot | null;
  formP2: FormSnapshot | null;
  h2h: H2HSnapshot | null;
  surfaceHint: "hard" | "clay" | "grass" | "unknown";
  dataQualityBoost: number; // 0–0.25 additionnel
};

function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(normalize(a).split(" ").filter(Boolean));
  const tb = new Set(normalize(b).split(" ").filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

function inferSurface(eventName: string, venue?: string): RecentMatch["surface"] {
  const s = `${eventName} ${venue || ""}`.toLowerCase();
  if (/clay|terre|roland|barcelona|madrid|rome|monte.?carlo|buenos|rio|santiago|bastad|hamburg|geneva|umag/.test(s))
    return "clay";
  if (/grass|wimbledon|halle|queens|eastbourne|s-hertogenbosch|newport|stuttgart.*grass/.test(s))
    return "grass";
  if (/hard|indoor|masters|open|dubai|miami|indian wells|cincinnati|shanghai|paris|vienna|basel|stockholm|sofia|montpellier/.test(s))
    return "hard";
  return "unknown";
}

type IndexedResult = RecentMatch & { playerKey: string };

let cache: { at: number; byPlayer: Map<string, RecentMatch[]> } | null = null;
const CACHE_MS = 15 * 60 * 1000;

async function fetchTourScoreboard(tour: "atp" | "wta"): Promise<any> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/tennis/${tour}/scoreboard`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TennisIntelligenceEngine/0.1)" },
      next: { revalidate: 900 },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function extractResults(data: any): IndexedResult[] {
  const out: IndexedResult[] = [];
  if (!data) return out;
  for (const event of data.events || []) {
    const eventName = event.name || event.shortName || "";
    const venue = event.venue?.displayName || "";
    const surface = inferSurface(eventName, venue);
    for (const g of event.groupings || []) {
      for (const c of g.competitions || []) {
        const st = c.status?.type?.name;
        if (st !== "STATUS_FINAL") continue;
        const comps = c.competitors || [];
        if (comps.length < 2) continue;
        const a = comps[0];
        const b = comps[1];
        const nameA = a.athlete?.displayName || a.athlete?.fullName;
        const nameB = b.athlete?.displayName || b.athlete?.fullName;
        if (!nameA || !nameB) continue;
        const note = (c.notes || []).find((n: any) => n.type === "event")?.text;
        const date = c.date || event.date || "";
        const base = {
          date,
          scoreText: note,
          eventName,
          surface,
        };
        out.push({
          ...base,
          playerKey: normalize(nameA),
          won: Boolean(a.winner),
          opponent: nameB,
        });
        out.push({
          ...base,
          playerKey: normalize(nameB),
          won: Boolean(b.winner),
          opponent: nameA,
        });
      }
    }
  }
  return out;
}

async function getIndex(): Promise<Map<string, RecentMatch[]>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.byPlayer;
  const [atp, wta] = await Promise.all([
    fetchTourScoreboard("atp"),
    fetchTourScoreboard("wta"),
  ]);
  const all = [...extractResults(atp), ...extractResults(wta)];
  const byPlayer = new Map<string, RecentMatch[]>();
  for (const r of all) {
    const list = byPlayer.get(r.playerKey) || [];
    list.push({
      date: r.date,
      won: r.won,
      opponent: r.opponent,
      scoreText: r.scoreText,
      eventName: r.eventName,
      surface: r.surface,
    });
    byPlayer.set(r.playerKey, list);
  }
  // sort each by date desc
  for (const [k, list] of byPlayer) {
    list.sort((a, b) => (a.date < b.date ? 1 : -1));
    byPlayer.set(k, list);
  }
  cache = { at: Date.now(), byPlayer };
  return byPlayer;
}

function findPlayerKey(
  index: Map<string, RecentMatch[]>,
  name: string
): string | null {
  const n = normalize(name);
  if (index.has(n)) return n;
  let best: { key: string; score: number } | null = null;
  for (const key of index.keys()) {
    const score = tokenOverlap(name, key);
    if (score >= 0.5 && (!best || score > best.score)) best = { key, score };
  }
  return best?.key || null;
}

function buildForm(matches: RecentMatch[]): FormSnapshot {
  const slice = (n: number) => matches.slice(0, n);
  const stats = (arr: RecentMatch[]) => {
    const played = arr.length;
    const won = arr.filter((m) => m.won).length;
    return {
      played,
      won,
      winPct: played > 0 ? Math.round((won / played) * 1000) / 10 : 0,
    };
  };
  let reliability = 0.25;
  if (matches.length >= 3) reliability = 0.5;
  if (matches.length >= 5) reliability = 0.65;
  if (matches.length >= 10) reliability = 0.8;
  return {
    last5: stats(slice(5)),
    last10: stats(slice(10)),
    last20: stats(slice(20)),
    reliability,
    source: "espn_scoreboard",
    asOf: new Date().toISOString(),
    matches: matches.slice(0, 20),
  };
}

function buildH2H(
  matchesP1: RecentMatch[],
  p1Name: string,
  p2Name: string
): H2HSnapshot | null {
  const vs = matchesP1.filter((m) => tokenOverlap(m.opponent, p2Name) >= 0.5);
  if (vs.length === 0) return null;
  const p1Wins = vs.filter((m) => m.won).length;
  return {
    total: vs.length,
    p1Wins,
    p2Wins: vs.length - p1Wins,
    recent: vs.slice(0, 10),
    reliability: vs.length >= 3 ? 0.7 : 0.4,
  };
}

/**
 * Charge forme + H2H pour deux joueurs.
 */
export async function loadPlayerStatsBundle(
  player1Name: string,
  player2Name: string,
  tournamentHint?: string
): Promise<PlayerStatsBundle> {
  const index = await getIndex();
  const key1 = findPlayerKey(index, player1Name);
  const key2 = findPlayerKey(index, player2Name);
  const matches1 = key1 ? index.get(key1) || [] : [];
  const matches2 = key2 ? index.get(key2) || [] : [];

  const formP1 = matches1.length ? buildForm(matches1) : null;
  const formP2 = matches2.length ? buildForm(matches2) : null;
  const h2h = matches1.length
    ? buildH2H(matches1, player1Name, player2Name)
    : null;

  const surfaceHint = tournamentHint
    ? inferSurface(tournamentHint)
    : "unknown";

  let boost = 0;
  if (formP1 && formP1.reliability >= 0.5) boost += 0.08;
  if (formP2 && formP2.reliability >= 0.5) boost += 0.08;
  if (h2h && h2h.total >= 2) boost += 0.05;
  if (surfaceHint !== "unknown") boost += 0.02;

  return {
    formP1,
    formP2,
    h2h,
    surfaceHint,
    dataQualityBoost: Math.min(0.25, boost),
  };
}

/**
 * Ajuste la proba match selon forme récente (léger).
 * winPct last5/10 → tilt max ±6 pts de pourcentage.
 */
export function adjustProbWithForm(
  pMatch: number,
  formP1: FormSnapshot | null,
  formP2: FormSnapshot | null
): number {
  let tilt = 0;
  if (formP1 && formP1.last5.played >= 3) {
    tilt += ((formP1.last5.winPct - 50) / 50) * 0.04;
  }
  if (formP2 && formP2.last5.played >= 3) {
    tilt -= ((formP2.last5.winPct - 50) / 50) * 0.04;
  }
  if (formP1 && formP1.last10.played >= 5) {
    tilt += ((formP1.last10.winPct - 50) / 50) * 0.025;
  }
  if (formP2 && formP2.last10.played >= 5) {
    tilt -= ((formP2.last10.winPct - 50) / 50) * 0.025;
  }
  return Math.max(0.08, Math.min(0.92, pMatch + tilt));
}

/**
 * Léger ajustement H2H si échantillon ≥ 3.
 */
export function adjustProbWithH2H(
  pMatch: number,
  h2h: H2HSnapshot | null
): number {
  if (!h2h || h2h.total < 3) return pMatch;
  const h2hP1 = h2h.p1Wins / h2h.total;
  return Math.max(0.08, Math.min(0.92, 0.88 * pMatch + 0.12 * h2hP1));
}
