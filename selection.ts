/**
 * ValueEngine + SelectionEngine — version TS pour l'API Next
 * Règles strictes : cote ≥ 1.25, EV > seuil, confiance, risque, qualité données
 */

export type MarketOpportunity = {
  marketId: string;
  marketType: string;
  marketName: string;
  selectionKey: string;
  selectionLabel: string;
  decimalOdds: number;
  estimatedProbability: number;
  impliedProbability: number;
  expectedValue: number;
  confidence: number;
  riskScore: number;
  dataQuality: number;
  modelPerformanceScore: number;
  factors: Record<string, string | number>;
};

export type SelectionResult = {
  status: 'SELECTED' | 'NO_VALID_PREDICTION';
  opportunity: MarketOpportunity | null;
  reason: string;
  ranked: MarketOpportunity[];
};

const MIN_ODDS = 1.25;
const MIN_EV = 0.03;
const MIN_CONFIDENCE = 55;
const MAX_RISK = 7.0;
const MIN_DATA_QUALITY = 0.45;

export function expectedValue(p: number, odds: number): number {
  return p * odds - 1;
}

export function impliedProbability(odds: number): number {
  return 1 / odds;
}

export function computeRiskScore(
  odds: number,
  confidence: number,
  dataQuality: number
): number {
  const oddsRisk = Math.min((odds - 1.25) / 4, 1) * 4;
  const confRisk = ((100 - confidence) / 100) * 3;
  const dataRisk = (1 - dataQuality) * 3;
  return Math.min(10, Math.round((oddsRisk + confRisk + dataRisk) * 10) / 10);
}

/**
 * Elo expected score
 */
export function eloProb(rA: number, rB: number): number {
  return 1 / (1 + Math.pow(10, (rB - rA) / 400));
}

export function selectBest(opportunities: MarketOpportunity[]): SelectionResult {
  const valid = opportunities.filter((op) => {
    if (op.decimalOdds < MIN_ODDS) return false;
    if (op.expectedValue < MIN_EV) return false;
    if (op.confidence < MIN_CONFIDENCE) return false;
    if (op.riskScore > MAX_RISK) return false;
    if (op.dataQuality < MIN_DATA_QUALITY) return false;
    return true;
  });

  if (valid.length === 0) {
    return {
      status: 'NO_VALID_PREDICTION',
      opportunity: null,
      reason:
        'Aucun marché ne satisfait les critères (cote ≥ 1.25, EV ≥ 3 %, confiance, risque, qualité données).',
      ranked: rank(opportunities),
    };
  }

  const ranked = rank(valid);
  return {
    status: 'SELECTED',
    opportunity: ranked[0],
    reason: `Meilleure opportunité — EV ${(ranked[0].expectedValue * 100).toFixed(1)} %, conf ${ranked[0].confidence.toFixed(0)} %`,
    ranked,
  };
}

function rank(ops: MarketOpportunity[]): MarketOpportunity[] {
  return [...ops]
    .map((op) => {
      const evScore = Math.min(Math.max(op.expectedValue, 0) / 0.25, 1);
      const confScore = op.confidence / 100;
      const riskScore = 1 - Math.min(op.riskScore / 10, 1);
      const dq = op.dataQuality;
      const model = Math.min(Math.max(op.modelPerformanceScore, 0), 1);
      const composite =
        0.35 * evScore + 0.25 * confScore + 0.15 * riskScore + 0.15 * dq + 0.1 * model;
      return { op, composite };
    })
    .sort((a, b) => b.composite - a.composite)
    .map((x) => x.op);
}

/**
 * Construit les opportunités Moneyline à partir des cotes + proba modèle.
 */
export function buildMoneylineOpportunities(params: {
  eventId: string;
  player1Name: string;
  player2Name: string;
  oddsP1: number | null;
  oddsP2: number | null;
  p1WinProb: number;
  confidence: number;
  dataQuality: number;
  modelName: string;
  modelPerformanceScore?: number;
  factors?: Record<string, string | number>;
}): MarketOpportunity[] {
  const ops: MarketOpportunity[] = [];
  const {
    eventId,
    player1Name,
    player2Name,
    oddsP1,
    oddsP2,
    p1WinProb,
    confidence,
    dataQuality,
    modelName,
    modelPerformanceScore = 0.5,
    factors = {},
  } = params;

  const baseFactors = { model: modelName, ...factors };

  if (oddsP1 != null && oddsP1 >= 1.01) {
    const ev = expectedValue(p1WinProb, oddsP1);
    ops.push({
      marketId: `${eventId}_ml`,
      marketType: 'match_winner',
      marketName: 'Vainqueur du Match',
      selectionKey: 'p1',
      selectionLabel: player1Name,
      decimalOdds: oddsP1,
      estimatedProbability: p1WinProb,
      impliedProbability: impliedProbability(oddsP1),
      expectedValue: ev,
      confidence,
      riskScore: computeRiskScore(oddsP1, confidence, dataQuality),
      dataQuality,
      modelPerformanceScore,
      factors: baseFactors,
    });
  }

  if (oddsP2 != null && oddsP2 >= 1.01) {
    const p2 = 1 - p1WinProb;
    const ev = expectedValue(p2, oddsP2);
    ops.push({
      marketId: `${eventId}_ml`,
      marketType: 'match_winner',
      marketName: 'Vainqueur du Match',
      selectionKey: 'p2',
      selectionLabel: player2Name,
      decimalOdds: oddsP2,
      estimatedProbability: p2,
      impliedProbability: impliedProbability(oddsP2),
      expectedValue: ev,
      confidence,
      riskScore: computeRiskScore(oddsP2, confidence, dataQuality),
      dataQuality,
      modelPerformanceScore,
      factors: baseFactors,
    });
  }

  return ops;
}
