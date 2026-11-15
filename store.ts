/**
 * Store des prédictions / analyses.
 * - Supabase si NEXT_PUBLIC_SUPABASE_URL + clé configurés
 * - sinon fichier JSON local (data/predictions.json)
 * Aucune statistique fictive.
 */

import { promises as fs } from "fs";
import path from "path";
import { getSupabaseServer, isSupabaseConfigured } from "./supabase/client";

export type StoredPrediction = {
  id: string;
  createdAt: string;
  player1: string;
  player2: string;
  eventId?: string;
  tournament?: string;
  isLive?: boolean;
  startTime?: string;
  status: "SELECTED" | "NO_VALID_PREDICTION" | "AMBIGUOUS" | "ERROR";
  market?: string;
  selection?: string;
  selectionKey?: string;
  odds?: number;
  estimatedProb?: number;
  expectedValue?: number;
  confidence?: number;
  riskScore?: number;
  dataQuality?: number;
  model?: string;
  settled?: boolean;
  settledAt?: string;
  result?: "win" | "loss" | "void" | "pending";
  profitUnits?: number;
  notes?: string;
  raw?: Record<string, unknown>;
};

function resolveFile(): string {
  return path.join(process.cwd(), "data", "predictions.json");
}

function rowToPrediction(row: any): StoredPrediction {
  return {
    id: row.id,
    createdAt: row.created_at,
    player1: row.player1,
    player2: row.player2,
    eventId: row.event_id ?? undefined,
    tournament: row.tournament ?? undefined,
    isLive: row.is_live ?? undefined,
    startTime: row.start_time ?? undefined,
    status: row.status,
    market: row.market ?? undefined,
    selection: row.selection ?? undefined,
    selectionKey: row.selection_key ?? undefined,
    odds: row.odds != null ? Number(row.odds) : undefined,
    estimatedProb: row.estimated_prob != null ? Number(row.estimated_prob) : undefined,
    expectedValue: row.expected_value != null ? Number(row.expected_value) : undefined,
    confidence: row.confidence != null ? Number(row.confidence) : undefined,
    riskScore: row.risk_score != null ? Number(row.risk_score) : undefined,
    dataQuality: row.data_quality != null ? Number(row.data_quality) : undefined,
    model: row.model ?? undefined,
    settled: row.settled ?? false,
    settledAt: row.settled_at ?? undefined,
    result: row.result ?? undefined,
    profitUnits: row.profit_units != null ? Number(row.profit_units) : undefined,
    notes: row.notes ?? undefined,
    raw: row.raw ?? undefined,
  };
}

function predictionToRow(p: StoredPrediction) {
  return {
    id: p.id,
    created_at: p.createdAt,
    player1: p.player1,
    player2: p.player2,
    event_id: p.eventId ?? null,
    tournament: p.tournament ?? null,
    is_live: p.isLive ?? false,
    start_time: p.startTime ?? null,
    status: p.status,
    market: p.market ?? null,
    selection: p.selection ?? null,
    selection_key: p.selectionKey ?? null,
    odds: p.odds ?? null,
    estimated_prob: p.estimatedProb ?? null,
    expected_value: p.expectedValue ?? null,
    confidence: p.confidence ?? null,
    risk_score: p.riskScore ?? null,
    data_quality: p.dataQuality ?? null,
    model: p.model ?? null,
    settled: p.settled ?? false,
    settled_at: p.settledAt ?? null,
    result: p.result ?? null,
    profit_units: p.profitUnits ?? null,
    notes: p.notes ?? null,
    raw: p.raw ?? {},
  };
}

// ——— File backend ———

async function fileLoad(): Promise<StoredPrediction[]> {
  const file = resolveFile();
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const raw = await fs.readFile(file, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function fileSave(list: StoredPrediction[]): Promise<void> {
  const file = resolveFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(list, null, 2), "utf8");
}

// ——— Supabase backend ———

async function sbLoad(): Promise<StoredPrediction[]> {
  const sb = getSupabaseServer();
  if (!sb) return fileLoad();
  const { data, error } = await sb
    .from("app_predictions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) {
    console.error("[store] supabase load error:", error.message);
    throw new Error(`Lecture Supabase impossible : ${error.message}`);
  }
  return (data || []).map(rowToPrediction);
}

async function sbInsert(p: StoredPrediction): Promise<void> {
  const sb = getSupabaseServer();
  if (!sb) return;
  const { error } = await sb.from("app_predictions").insert(predictionToRow(p));
  if (error) {
    console.error("[store] supabase insert error:", error.message);
    throw new Error(`Enregistrement Supabase impossible : ${error.message}`);
  }
}

async function sbUpdate(p: StoredPrediction): Promise<void> {
  const sb = getSupabaseServer();
  if (!sb) return;
  const { error } = await sb
    .from("app_predictions")
    .update(predictionToRow(p))
    .eq("id", p.id);
  if (error) {
    console.error("[store] supabase update error:", error.message);
    throw new Error(`Mise à jour Supabase impossible : ${error.message}`);
  }
}

// ——— Public API ———

export async function loadPredictions(): Promise<StoredPrediction[]> {
  if (isSupabaseConfigured()) return sbLoad();
  return fileLoad();
}

export async function appendPrediction(
  p: Omit<StoredPrediction, "id" | "createdAt"> & { id?: string; createdAt?: string }
): Promise<StoredPrediction> {
  const entry: StoredPrediction = {
    id: p.id || `pred_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: p.createdAt || new Date().toISOString(),
    ...p,
  };

  if (isSupabaseConfigured()) {
    await sbInsert(entry);
    // miroir fichier optionnel pour backup local
    try {
      const list = await fileLoad();
      list.unshift(entry);
      await fileSave(list.slice(0, 5000));
    } catch {
      /* ignore */
    }
    return entry;
  }

  const list = await fileLoad();
  list.unshift(entry);
  await fileSave(list.slice(0, 5000));
  return entry;
}

export async function settlePrediction(
  id: string,
  result: "win" | "loss" | "void",
  notes?: string
): Promise<StoredPrediction | null> {
  const list = await loadPredictions();
  const idx = list.findIndex((x) => x.id === id);
  if (idx < 0) return null;
  const pred = { ...list[idx] };
  pred.settled = true;
  pred.settledAt = new Date().toISOString();
  pred.result = result;
  pred.notes = notes;
  if (pred.status === "SELECTED" && pred.odds) {
    if (result === "win") pred.profitUnits = pred.odds - 1;
    else if (result === "loss") pred.profitUnits = -1;
    else pred.profitUnits = 0;
  } else {
    pred.profitUnits = 0;
  }

  if (isSupabaseConfigured()) {
    await sbUpdate(pred);
  }

  // Toujours synchroniser le fichier local si présent
  try {
    const fileList = await fileLoad();
    const fi = fileList.findIndex((x) => x.id === id);
    if (fi >= 0) {
      fileList[fi] = pred;
      await fileSave(fileList);
    } else if (!isSupabaseConfigured()) {
      list[idx] = pred;
      await fileSave(list);
    }
  } catch {
    if (!isSupabaseConfigured()) {
      list[idx] = pred;
      await fileSave(list);
    }
  }

  return pred;
}

export type PerformanceStats = {
  totalAnalyses: number;
  selected: number;
  noValid: number;
  settled: number;
  wins: number;
  losses: number;
  voids: number;
  hitRate: number | null;
  roi: number | null;
  profitUnits: number;
  avgOdds: number | null;
  avgEv: number | null;
  byMarket: Record<string, { n: number; wins: number; losses: number; profit: number }>;
  byModel: Record<string, { n: number; wins: number; losses: number; profit: number }>;
  recent: StoredPrediction[];
  backend: "supabase" | "file";
};

export function computePerformance(list: StoredPrediction[]): PerformanceStats {
  const selected = list.filter((p) => p.status === "SELECTED");
  const noValid = list.filter((p) => p.status === "NO_VALID_PREDICTION");
  const settled = selected.filter((p) => p.settled && p.result && p.result !== "pending");
  const wins = settled.filter((p) => p.result === "win");
  const losses = settled.filter((p) => p.result === "loss");
  const voids = settled.filter((p) => p.result === "void");
  const decided = wins.length + losses.length;
  const profitUnits = settled.reduce((s, p) => s + (p.profitUnits || 0), 0);

  const avgOdds =
    selected.length > 0
      ? selected.reduce((s, p) => s + (p.odds || 0), 0) / selected.length
      : null;
  const avgEv =
    selected.length > 0
      ? selected.reduce((s, p) => s + (p.expectedValue || 0), 0) / selected.length
      : null;

  const byMarket: PerformanceStats["byMarket"] = {};
  const byModel: PerformanceStats["byModel"] = {};

  for (const p of selected) {
    const mk = p.market || "unknown";
    if (!byMarket[mk]) byMarket[mk] = { n: 0, wins: 0, losses: 0, profit: 0 };
    byMarket[mk].n++;
    if (p.result === "win") byMarket[mk].wins++;
    if (p.result === "loss") byMarket[mk].losses++;
    byMarket[mk].profit += p.profitUnits || 0;

    const mod = p.model || "unknown";
    if (!byModel[mod]) byModel[mod] = { n: 0, wins: 0, losses: 0, profit: 0 };
    byModel[mod].n++;
    if (p.result === "win") byModel[mod].wins++;
    if (p.result === "loss") byModel[mod].losses++;
    byModel[mod].profit += p.profitUnits || 0;
  }

  return {
    totalAnalyses: list.length,
    selected: selected.length,
    noValid: noValid.length,
    settled: settled.length,
    wins: wins.length,
    losses: losses.length,
    voids: voids.length,
    hitRate: decided > 0 ? wins.length / decided : null,
    roi: decided > 0 ? profitUnits / decided : null,
    profitUnits,
    avgOdds,
    avgEv,
    byMarket,
    byModel,
    recent: list.slice(0, 30),
    backend: isSupabaseConfigured() ? "supabase" : "file",
  };
}

export { isSupabaseConfigured };
