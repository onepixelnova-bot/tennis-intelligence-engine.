import { NextRequest, NextResponse } from "next/server";
import { fetchTennisEvents, matchPlayers } from "@/lib/betpawa";
import { fetchEventMarkets } from "@/lib/betpawa-markets";
import { selectBest } from "@/lib/selection";
import { resolveTwoPlayers } from "@/lib/rankings";
import { marketsToOpportunities } from "@/lib/market-models";
import { appendPrediction } from "@/lib/store";
import { loadPlayerStatsBundle } from "@/lib/player-stats";
import { mlPredict } from "@/lib/ml-client";
import { analyzePhysical } from "@/lib/physical";

const DEFAULT_ELO = 1500;

export async function POST(req: NextRequest) {
  const started = Date.now();
  try {
    const body = await req.json();
    const player1 = (body.player1 || "").trim();
    const player2 = (body.player2 || "").trim();
    const preferredEventId = body.eventId ? String(body.eventId) : null;
    const persist = body.persist !== false;

    if (!player1 || !player2) {
      return NextResponse.json(
        { status: "ERROR", message: "Les deux joueurs sont requis." },
        { status: 400 }
      );
    }

    let events: Awaited<ReturnType<typeof fetchTennisEvents>>;
    try {
      events = await fetchTennisEvents();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Erreur réseau inconnue";
      return NextResponse.json(
        {
          status: "ERROR",
          message: `BetPawa inaccessible : ${detail}. Aucune cote ni donnée de remplacement n’a été inventée.`,
          analyzedAt: new Date().toISOString(),
          durationMs: Date.now() - started,
        },
        { status: 502 }
      );
    }
    let matches = matchPlayers(events, player1, player2);
    if (preferredEventId) {
      matches = matches.filter((m) => m.id === preferredEventId);
    }

    if (matches.length === 0) {
      return NextResponse.json({
        status: "NO_VALID_PREDICTION",
        player1,
        player2,
        message:
          events.length === 0
            ? "Impossible de récupérer les événements BetPawa."
            : `Aucun match trouvé pour « ${player1} » vs « ${player2} » (${events.length} événements).`,
        eventsAvailable: events.length,
        analyzedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
      });
    }

    if (matches.length > 1 && !preferredEventId) {
      return NextResponse.json({
        status: "AMBIGUOUS",
        player1,
        player2,
        message: "Plusieurs rencontres correspondent. Choisissez-en une.",
        candidates: matches.slice(0, 6).map((m) => ({
          eventId: m.id,
          player1: m.player1Name,
          player2: m.player2Name,
          startTime: m.startTime,
          isLive: m.isLive,
          odds:
            m.oddsP1 && m.oddsP2
              ? `${m.oddsP1.toFixed(2)} / ${m.oddsP2.toFixed(2)}`
              : null,
        })),
        analyzedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
      });
    }

    const m = matches[0];

    const [ranksForMatch, bundle, statsBundle] = await Promise.all([
      resolveTwoPlayers(m.player1Name, m.player2Name),
      fetchEventMarkets(m.id),
      loadPlayerStatsBundle(m.player1Name, m.player2Name, m.tournamentHint),
    ]);

    const eloP1 = ranksForMatch.p1?.entry.elo ?? DEFAULT_ELO;
    const eloP2 = ranksForMatch.p2?.entry.elo ?? DEFAULT_ELO;
    const hasRealElo = !!(ranksForMatch.p1 && ranksForMatch.p2);

    const phys1 = analyzePhysical(statsBundle.formP1);
    const phys2 = analyzePhysical(statsBundle.formP2);

    const ml = await mlPredict({
      player1: m.player1Name,
      player2: m.player2Name,
      elo_p1: eloP1,
      elo_p2: eloP2,
      form_winpct_p1_l5: statsBundle.formP1?.last5.winPct ?? null,
      form_winpct_p2_l5: statsBundle.formP2?.last5.winPct ?? null,
      form_winpct_p1_l10: statsBundle.formP1?.last10.winPct ?? null,
      form_winpct_p2_l10: statsBundle.formP2?.last10.winPct ?? null,
      h2h_p1_rate:
        statsBundle.h2h && statsBundle.h2h.total > 0
          ? statsBundle.h2h.p1Wins / statsBundle.h2h.total
          : null,
      h2h_n: statsBundle.h2h?.total ?? 0,
      surface: statsBundle.surfaceHint,
      matches_last_14d_p1: phys1.matchesLast14d,
      matches_last_14d_p2: phys2.matchesLast14d,
      is_live: m.isLive,
      odds_p1: m.oddsP1,
      odds_p2: m.oddsP2,
    });

    const pMatch = ml.p1_win_match;
    const dataQuality = ml.data_quality;
    const confidenceMatch = ml.confidence;

    const markets = bundle?.markets || [];
    if (markets.length === 0 && m.oddsP1 && m.oddsP2) {
      markets.push({
        marketTypeId: "2043818",
        marketName: "Vainqueur du Match",
        line: null,
        prices: [
          { key: "p1", label: m.player1Name, odds: m.oddsP1, suspended: false },
          { key: "p2", label: m.player2Name, odds: m.oddsP2, suspended: false },
        ],
      });
    }

    const opportunities = marketsToOpportunities(markets, {
      eventId: m.id,
      player1Name: m.player1Name,
      player2Name: m.player2Name,
      pMatch,
      eloP1,
      eloP2,
      confidenceMatch,
      dataQuality,
      modelPerformanceScore: hasRealElo ? 0.6 : 0.38,
      hasRealElo,
    });

    const selection = selectBest(opportunities);

    const rankingInfo = {
      p1: ranksForMatch.p1
        ? {
            name: ranksForMatch.p1.entry.name,
            rank: ranksForMatch.p1.entry.rank,
            tour: ranksForMatch.p1.entry.tour,
            elo: ranksForMatch.p1.entry.elo,
          }
        : null,
      p2: ranksForMatch.p2
        ? {
            name: ranksForMatch.p2.entry.name,
            rank: ranksForMatch.p2.entry.rank,
            tour: ranksForMatch.p2.entry.tour,
            elo: ranksForMatch.p2.entry.elo,
          }
        : null,
    };

    const playerStats = {
      formP1: statsBundle.formP1
        ? {
            last5: statsBundle.formP1.last5,
            last10: statsBundle.formP1.last10,
            reliability: statsBundle.formP1.reliability,
          }
        : null,
      formP2: statsBundle.formP2
        ? {
            last5: statsBundle.formP2.last5,
            last10: statsBundle.formP2.last10,
            reliability: statsBundle.formP2.reliability,
          }
        : null,
      h2h: statsBundle.h2h
        ? {
            total: statsBundle.h2h.total,
            p1Wins: statsBundle.h2h.p1Wins,
            p2Wins: statsBundle.h2h.p2Wins,
            reliability: statsBundle.h2h.reliability,
          }
        : null,
      surfaceHint: statsBundle.surfaceHint,
      physicalP1: phys1,
      physicalP2: phys2,
    };

    const marketsSummary = markets.map((x) => ({
      type: x.marketTypeId,
      name: x.marketName,
      line: x.line,
      nPrices: x.prices.length,
    }));

    if (selection.status === "SELECTED" && selection.opportunity) {
      const op = selection.opportunity;
      const responseBody = {
        status: "SELECTED" as const,
        player1: m.player1Name,
        player2: m.player2Name,
        eventId: m.id,
        isLive: m.isLive,
        startTime: m.startTime || bundle?.startTime,
        tournament: bundle?.competition || m.tournamentHint,
        market: op.marketName,
        selection: op.selectionLabel,
        selectionKey: op.selectionKey,
        odds: op.decimalOdds,
        estimatedProb: op.estimatedProbability,
        expectedValue: op.expectedValue,
        confidence: op.confidence,
        riskScore: op.riskScore,
        dataQuality: op.dataQuality,
        model: ml.model,
        mlSource: ml.source,
        rankings: rankingInfo,
        playerStats,
        marketsAnalyzed: opportunities.length,
        marketsAvailable: marketsSummary,
        factors: [
          `Marché: ${op.marketName}`,
          `ML: ${ml.model} (${ml.source})`,
          ...ml.factors.slice(0, 4),
          ranksForMatch.p1
            ? `${ranksForMatch.p1.entry.name} #${ranksForMatch.p1.entry.rank} Elo≈${eloP1}`
            : `P1 Elo défaut ${eloP1}`,
          ranksForMatch.p2
            ? `${ranksForMatch.p2.entry.name} #${ranksForMatch.p2.entry.rank} Elo≈${eloP2}`
            : `P2 Elo défaut ${eloP2}`,
          statsBundle.formP1
            ? `Forme P1 L5: ${statsBundle.formP1.last5.won}/${statsBundle.formP1.last5.played}`
            : "Forme P1: n/a",
          statsBundle.formP2
            ? `Forme P2 L5: ${statsBundle.formP2.last5.won}/${statsBundle.formP2.last5.played}`
            : "Forme P2: n/a",
          `Charge P1: ${phys1.riskFlag} (${phys1.matchesLast14d} m/14j)`,
          `Charge P2: ${phys2.riskFlag} (${phys2.matchesLast14d} m/14j)`,
          statsBundle.h2h
            ? `H2H: ${statsBundle.h2h.p1Wins}-${statsBundle.h2h.p2Wins}`
            : "H2H: n/a",
          `EV: ${(op.expectedValue * 100).toFixed(1)} %`,
        ],
        reason: selection.reason,
        analyzedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
      };

      if (persist) {
        const saved = await appendPrediction({
          status: "SELECTED",
          player1: responseBody.player1,
          player2: responseBody.player2,
          eventId: responseBody.eventId,
          tournament: responseBody.tournament,
          isLive: responseBody.isLive,
          startTime: responseBody.startTime || undefined,
          market: responseBody.market,
          selection: responseBody.selection,
          selectionKey: responseBody.selectionKey,
          odds: responseBody.odds,
          estimatedProb: responseBody.estimatedProb,
          expectedValue: responseBody.expectedValue,
          confidence: responseBody.confidence,
          riskScore: responseBody.riskScore,
          dataQuality: responseBody.dataQuality,
          model: responseBody.model,
          result: "pending",
          settled: false,
        });
        return NextResponse.json({ ...responseBody, predictionId: saved.id });
      }
      return NextResponse.json(responseBody);
    }

    const bestRejected = selection.ranked[0] || null;
    const responseBody = {
      status: "NO_VALID_PREDICTION" as const,
      player1: m.player1Name,
      player2: m.player2Name,
      eventId: m.id,
      isLive: m.isLive,
      startTime: m.startTime || bundle?.startTime,
      tournament: bundle?.competition || m.tournamentHint,
      market: "multi",
      oddsP1: m.oddsP1,
      oddsP2: m.oddsP2,
      rankings: rankingInfo,
      playerStats,
      model: ml.model,
      mlSource: ml.source,
      marketsAnalyzed: opportunities.length,
      marketsAvailable: marketsSummary,
      message: selection.reason,
      diagnostic: bestRejected
        ? {
            bestLabel: bestRejected.selectionLabel,
            market: bestRejected.marketName,
            odds: bestRejected.decimalOdds,
            estimatedProb: bestRejected.estimatedProbability,
            ev: bestRejected.expectedValue,
            confidence: bestRejected.confidence,
            riskScore: bestRejected.riskScore,
            dataQuality: bestRejected.dataQuality,
          }
        : null,
      note: hasRealElo
        ? `${opportunities.length} opportunités — seuils non atteints.`
        : "Données joueurs limitées → qualité insuffisante pour valider.",
      analyzedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
    };

    if (persist) {
      await appendPrediction({
        status: "NO_VALID_PREDICTION",
        player1: responseBody.player1,
        player2: responseBody.player2,
        eventId: responseBody.eventId,
        tournament: responseBody.tournament,
        isLive: responseBody.isLive,
        startTime: responseBody.startTime || undefined,
        model: ml.model,
        notes: responseBody.message,
      });
    }

    return NextResponse.json(responseBody);
  } catch (e: any) {
    return NextResponse.json(
      {
        status: "ERROR",
        message: e.message || "Erreur serveur",
        analyzedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
      },
      { status: 500 }
    );
  }
}
