/**
 * Modèles de proba par type de marché.
 * Transparence : chaque modèle indique sa fiabilité.
 *
 * - match_winner : Elo (fiabilité moyenne-haute si rankings)
 * - first_set_winner : match_prob régressé vers 0.5 (1er set plus volatile)
 * - total_games : espérance de jeux selon écart Elo + baseline surface
 * - game handicap : dérivé de l'écart de jeux attendu
 */

import { MARKET_TYPES } from './betpawa-markets';
import type { ParsedMarket } from './betpawa-markets';
import type { MarketOpportunity } from './selection';
import {
  expectedValue,
  impliedProbability,
  computeRiskScore,
} from './selection';

export type ModelContext = {
  eventId: string;
  player1Name: string;
  player2Name: string;
  pMatch: number; // P(p1 wins match)
  eloP1: number;
  eloP2: number;
  confidenceMatch: number;
  dataQuality: number;
  modelPerformanceScore: number;
  hasRealElo: boolean;
};

/** P(p1 wins first set) ≈ shrinkage de P(match) vers 0.5 */
export function firstSetProb(pMatch: number): number {
  return 0.5 + (pMatch - 0.5) * 0.72;
}

/**
 * Espérance de jeux totaux (best of 3 approximé).
 * Baseline ~22 jeux, ajustée par écart Elo (match plus déséquilibré → un peu moins de jeux).
 */
export function expectedTotalGames(eloP1: number, eloP2: number): number {
  const gap = Math.abs(eloP1 - eloP2);
  // gap 0 → ~22.5 ; gap 200 → ~21.2 ; gap 400 → ~20.0
  return Math.max(18, Math.min(28, 22.6 - gap / 280));
}

/** P(over line) via approximation normale simple autour de expected total */
export function overProb(expected: number, line: number, sd = 3.8): number {
  // P(X > line) avec X ~ N(expected, sd^2) — continuity +0.0
  const z = (line - expected) / sd;
  // 1 - Phi(z)
  return 1 - normalCdf(z);
}

function normalCdf(z: number): number {
  // Approximation Abramowitz & Stegun
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  let p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) p = 1 - p;
  return p;
}

/**
 * Transforme les marchés parsés en opportunités évaluables.
 */
export function marketsToOpportunities(
  markets: ParsedMarket[],
  ctx: ModelContext
): MarketOpportunity[] {
  const ops: MarketOpportunity[] = [];

  for (const m of markets) {
    if (m.marketTypeId === MARKET_TYPES.MATCH_WINNER) {
      for (const pr of m.prices) {
        const p =
          pr.key === 'p1' ? ctx.pMatch : pr.key === 'p2' ? 1 - ctx.pMatch : null;
        if (p == null) continue;
        ops.push(
          makeOp({
            ctx,
            market: m,
            pr,
            estimatedProb: p,
            confidence: ctx.confidenceMatch,
            dataQuality: ctx.dataQuality,
            modelTag: 'elo_match',
          })
        );
      }
    }

    if (m.marketTypeId === MARKET_TYPES.FIRST_SET_WINNER) {
      const p1s = firstSetProb(ctx.pMatch);
      for (const pr of m.prices) {
        const p = pr.key === 'p1' ? p1s : pr.key === 'p2' ? 1 - p1s : null;
        if (p == null) continue;
        // 1er set un peu moins fiable
        const conf = Math.max(40, ctx.confidenceMatch - 8);
        const dq = ctx.dataQuality * 0.92;
        ops.push(
          makeOp({
            ctx,
            market: m,
            pr,
            estimatedProb: p,
            confidence: conf,
            dataQuality: dq,
            modelTag: 'elo_first_set_shrink',
          })
        );
      }
    }

    if (m.marketTypeId === MARKET_TYPES.TOTAL_GAMES && m.line != null) {
      const expG = expectedTotalGames(ctx.eloP1, ctx.eloP2);
      const pOver = overProb(expG, m.line);
      for (const pr of m.prices) {
        let p: number | null = null;
        if (pr.key.startsWith('over')) p = pOver;
        if (pr.key.startsWith('under')) p = 1 - pOver;
        if (p == null) continue;
        // Totaux : modèle plus approximatif
        const conf = ctx.hasRealElo ? 58 : 42;
        const dq = ctx.hasRealElo ? 0.55 : 0.3;
        ops.push(
          makeOp({
            ctx,
            market: m,
            pr,
            estimatedProb: p,
            confidence: conf,
            dataQuality: dq,
            modelTag: `total_games_exp_${expG.toFixed(1)}`,
          })
        );
      }
    }

    if (m.marketTypeId === MARKET_TYPES.TOTAL_SETS && m.line != null) {
      // Best of 3 : P(over 2.5) ≈ P(match va à 3 sets) ≈ 2*p*(1-p) roughly
      // line often 2.5 → over means 3 sets
      const pThreeSets = 2 * ctx.pMatch * (1 - ctx.pMatch);
      // clamp
      const p3 = Math.max(0.15, Math.min(0.55, pThreeSets * 1.05));
      for (const pr of m.prices) {
        let p: number | null = null;
        if (pr.key.startsWith('over')) p = p3;
        if (pr.key.startsWith('under')) p = 1 - p3;
        if (p == null) continue;
        const conf = ctx.hasRealElo ? 56 : 40;
        const dq = ctx.hasRealElo ? 0.5 : 0.28;
        ops.push(
          makeOp({
            ctx,
            market: m,
            pr,
            estimatedProb: p,
            confidence: conf,
            dataQuality: dq,
            modelTag: 'total_sets_bo3',
          })
        );
      }
    }
  }

  return ops;
}

function makeOp(args: {
  ctx: ModelContext;
  market: ParsedMarket;
  pr: { key: string; label: string; odds: number };
  estimatedProb: number;
  confidence: number;
  dataQuality: number;
  modelTag: string;
}): MarketOpportunity {
  const { ctx, market, pr, estimatedProb, confidence, dataQuality, modelTag } =
    args;
  const ev = expectedValue(estimatedProb, pr.odds);
  return {
    marketId: `${ctx.eventId}_${market.marketTypeId}_${pr.key}`,
    marketType: market.marketTypeId,
    marketName:
      market.line != null
        ? `${market.marketName} (${market.line})`
        : market.marketName,
    selectionKey: pr.key,
    selectionLabel: pr.label,
    decimalOdds: pr.odds,
    estimatedProbability: estimatedProb,
    impliedProbability: impliedProbability(pr.odds),
    expectedValue: ev,
    confidence,
    riskScore: computeRiskScore(pr.odds, confidence, dataQuality),
    dataQuality,
    modelPerformanceScore: ctx.modelPerformanceScore,
    factors: {
      model: modelTag,
      eloP1: ctx.eloP1,
      eloP2: ctx.eloP2,
      line: market.line ?? '',
    },
  };
}
