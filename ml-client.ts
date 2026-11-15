/**
 * Client du service ML FastAPI.
 * Fallback local si ML_SERVICE_URL indisponible.
 */

export type MlPredictInput = {
  player1: string;
  player2: string;
  elo_p1: number;
  elo_p2: number;
  form_winpct_p1_l5?: number | null;
  form_winpct_p2_l5?: number | null;
  form_winpct_p1_l10?: number | null;
  form_winpct_p2_l10?: number | null;
  h2h_p1_rate?: number | null;
  h2h_n?: number;
  surface?: string;
  matches_last_14d_p1?: number;
  matches_last_14d_p2?: number;
  is_live?: boolean;
  odds_p1?: number | null;
  odds_p2?: number | null;
};

export type MlPredictResult = {
  p1_win_match: number;
  p1_win_first_set: number;
  expected_total_games: number;
  p_three_sets: number;
  confidence: number;
  data_quality: number;
  model: string;
  factors: string[];
  source: "ml_service" | "local_fallback";
};

function localEnsemble(input: MlPredictInput): MlPredictResult {
  const eloGap = (input.elo_p1 - input.elo_p2) / 400;
  const pElo = 1 / (1 + Math.pow(10, -eloGap));

  let form5 = 0;
  if (input.form_winpct_p1_l5 != null && input.form_winpct_p2_l5 != null) {
    form5 = (input.form_winpct_p1_l5 - input.form_winpct_p2_l5) / 100;
  }
  let form10 = 0;
  if (input.form_winpct_p1_l10 != null && input.form_winpct_p2_l10 != null) {
    form10 = (input.form_winpct_p1_l10 - input.form_winpct_p2_l10) / 100;
  }
  let h2h = 0;
  if (input.h2h_p1_rate != null && (input.h2h_n || 0) >= 3) {
    h2h = (input.h2h_p1_rate - 0.5) * Math.min(1, (input.h2h_n || 0) / 8);
  }
  const fatigue =
    ((input.matches_last_14d_p2 || 0) - (input.matches_last_14d_p1 || 0)) * 0.02;

  const z = 1.35 * eloGap + 0.45 * form5 + 0.3 * form10 + 0.25 * h2h + 0.2 * fatigue;
  const pLog = 1 / (1 + Math.exp(-z));

  let richness = 0;
  for (const v of [
    input.form_winpct_p1_l5,
    input.form_winpct_p2_l5,
    input.form_winpct_p1_l10,
    input.form_winpct_p2_l10,
    (input.h2h_n || 0) >= 3 ? input.h2h_p1_rate : null,
  ]) {
    if (v != null) richness++;
  }
  const wLog = Math.min(0.75, 0.35 + 0.08 * richness);
  const pMatch = Math.max(0.06, Math.min(0.94, wLog * pLog + (1 - wLog) * pElo));

  let dq = input.elo_p1 !== 1500 || input.elo_p2 !== 1500 ? 0.7 : 0.35;
  let conf = input.elo_p1 !== 1500 || input.elo_p2 !== 1500 ? 64 : 48;
  dq = Math.min(0.95, dq + 0.04 * richness);
  conf = Math.min(88, conf + 3.5 * richness);

  const gap = Math.abs(input.elo_p1 - input.elo_p2);
  const expGames = Math.max(18, Math.min(28, 22.6 - gap / 280));

  return {
    p1_win_match: pMatch,
    p1_win_first_set: 0.5 + (pMatch - 0.5) * 0.72,
    expected_total_games: expGames,
    p_three_sets: Math.max(0.15, Math.min(0.55, 2 * pMatch * (1 - pMatch) * 1.05)),
    confidence: conf,
    data_quality: dq,
    model: "ensemble_elo_logistic_local_v0.2",
    factors: [
      `local ensemble w_log=${wLog.toFixed(2)}`,
      `elo ${input.elo_p1.toFixed(0)}/${input.elo_p2.toFixed(0)}`,
      `features=${richness}`,
    ],
    source: "local_fallback",
  };
}

export async function mlPredict(input: MlPredictInput): Promise<MlPredictResult> {
  const base = process.env.ML_SERVICE_URL || "http://127.0.0.1:8001";
  try {
    const res = await fetch(`${base}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return localEnsemble(input);
    const data = await res.json();
    return {
      p1_win_match: data.p1_win_match,
      p1_win_first_set: data.p1_win_first_set,
      expected_total_games: data.expected_total_games,
      p_three_sets: data.p_three_sets,
      confidence: data.confidence,
      data_quality: data.data_quality,
      model: data.model,
      factors: data.factors || [],
      source: "ml_service",
    };
  } catch {
    return localEnsemble(input);
  }
}
