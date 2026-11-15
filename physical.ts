/**
 * Analyse physique / charge — dérivée des dates de matchs récents ESPN.
 * Pas de GPS ni tracking médical : proxy honnête par volume de matchs.
 */

import type { FormSnapshot } from "./player-stats";

export type PhysicalSnapshot = {
  matchesLast7d: number;
  matchesLast14d: number;
  matchesLast21d: number;
  loadScore: number; // 0 frais → 10 saturé
  riskFlag: "low" | "medium" | "high";
  note: string;
};

function countSince(matches: { date: string }[], days: number): number {
  const cutoff = Date.now() - days * 86400000;
  return matches.filter((m) => {
    const t = Date.parse(m.date);
    return Number.isFinite(t) && t >= cutoff;
  }).length;
}

export function analyzePhysical(form: FormSnapshot | null): PhysicalSnapshot {
  if (!form || form.matches.length === 0) {
    return {
      matchesLast7d: 0,
      matchesLast14d: 0,
      matchesLast21d: 0,
      loadScore: 0,
      riskFlag: "low",
      note: "Pas de calendrier récent disponible",
    };
  }
  const m7 = countSince(form.matches, 7);
  const m14 = countSince(form.matches, 14);
  const m21 = countSince(form.matches, 21);
  // score : 3+ matchs / 7j ou 5+ / 14j → charge élevée
  let load = m7 * 2 + m14 * 0.8 + m21 * 0.3;
  load = Math.min(10, Math.round(load * 10) / 10);
  let risk: PhysicalSnapshot["riskFlag"] = "low";
  if (load >= 6) risk = "high";
  else if (load >= 3.5) risk = "medium";
  return {
    matchesLast7d: m7,
    matchesLast14d: m14,
    matchesLast21d: m21,
    loadScore: load,
    riskFlag: risk,
    note:
      risk === "high"
        ? "Charge élevée sur 14 jours — risque fatigue"
        : risk === "medium"
          ? "Charge modérée"
          : "Charge faible ou données limitées",
  };
}
