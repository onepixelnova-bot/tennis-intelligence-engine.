"""
Tennis Intelligence Engine — ML Service
Modèles : Elo baseline, logistic feature-based, ensemble calibré.
Aucune proba inventée hors features fournies.
"""
from __future__ import annotations

import math
from typing import Any, Optional

import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="TIE ML Service", version="0.2.0")


class PredictRequest(BaseModel):
    player1: str
    player2: str
    elo_p1: float = 1500
    elo_p2: float = 1500
    form_winpct_p1_l5: Optional[float] = None  # 0-100
    form_winpct_p2_l5: Optional[float] = None
    form_winpct_p1_l10: Optional[float] = None
    form_winpct_p2_l10: Optional[float] = None
    h2h_p1_rate: Optional[float] = None  # 0-1
    h2h_n: int = 0
    surface: str = "unknown"  # hard|clay|grass|unknown
    surface_winpct_p1: Optional[float] = None
    surface_winpct_p2: Optional[float] = None
    is_live: bool = False
    odds_p1: Optional[float] = None
    odds_p2: Optional[float] = None
    matches_last_14d_p1: int = 0
    matches_last_14d_p2: int = 0


class MarketProb(BaseModel):
    market: str
    selection: str
    probability: float
    model: str


class PredictResponse(BaseModel):
    p1_win_match: float
    p1_win_first_set: float
    expected_total_games: float
    p_three_sets: float
    confidence: float
    data_quality: float
    model: str
    factors: list[str]
    feature_vector: dict[str, float]


def elo_prob(r_a: float, r_b: float) -> float:
    return 1.0 / (1.0 + 10 ** ((r_b - r_a) / 400.0))


def sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def logistic_match_prob(req: PredictRequest) -> tuple[float, dict[str, float]]:
    """
    Logistic « expert weights » — coefficients stables, pas de fit inventé.
    En prod on remplace par un joblib entraîné sur historique réel.
    """
    elo_gap = (req.elo_p1 - req.elo_p2) / 400.0
    form5 = 0.0
    if req.form_winpct_p1_l5 is not None and req.form_winpct_p2_l5 is not None:
        form5 = (req.form_winpct_p1_l5 - req.form_winpct_p2_l5) / 100.0
    form10 = 0.0
    if req.form_winpct_p1_l10 is not None and req.form_winpct_p2_l10 is not None:
        form10 = (req.form_winpct_p1_l10 - req.form_winpct_p2_l10) / 100.0
    h2h = 0.0
    if req.h2h_p1_rate is not None and req.h2h_n >= 3:
        h2h = (req.h2h_p1_rate - 0.5) * min(1.0, req.h2h_n / 8.0)
    surf = 0.0
    if req.surface_winpct_p1 is not None and req.surface_winpct_p2 is not None:
        surf = (req.surface_winpct_p1 - req.surface_winpct_p2) / 100.0

    # fatigue : plus de matchs récents → léger malus
    fatigue = (req.matches_last_14d_p2 - req.matches_last_14d_p1) * 0.02

    features = {
        "elo_gap": elo_gap,
        "form5": form5,
        "form10": form10,
        "h2h": h2h,
        "surface": surf,
        "fatigue": fatigue,
    }
    # poids (somme ~ logique tennis)
    z = (
        1.35 * elo_gap
        + 0.45 * form5
        + 0.30 * form10
        + 0.25 * h2h
        + 0.35 * surf
        + 0.20 * fatigue
    )
    p = sigmoid(z)
    return float(np.clip(p, 0.05, 0.95)), features


def first_set_prob(p_match: float) -> float:
    return 0.5 + (p_match - 0.5) * 0.72


def expected_total_games(elo_p1: float, elo_p2: float) -> float:
    gap = abs(elo_p1 - elo_p2)
    return float(np.clip(22.6 - gap / 280.0, 18.0, 28.0))


def p_three_sets(p_match: float) -> float:
    return float(np.clip(2 * p_match * (1 - p_match) * 1.05, 0.15, 0.55))


@app.get("/health")
def health():
    return {"status": "ok", "service": "tie-ml", "version": "0.2.0"}


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    p_elo = elo_prob(req.elo_p1, req.elo_p2)
    p_log, feats = logistic_match_prob(req)

    # Ensemble : plus de features → plus de poids logistic
    feature_richness = sum(
        1
        for v in [
            req.form_winpct_p1_l5,
            req.form_winpct_p2_l5,
            req.form_winpct_p1_l10,
            req.form_winpct_p2_l10,
            req.h2h_p1_rate if req.h2h_n >= 3 else None,
            req.surface_winpct_p1,
        ]
        if v is not None
    )
    w_log = 0.35 + 0.08 * feature_richness  # 0.35–0.83
    w_log = min(0.75, w_log)
    p_match = w_log * p_log + (1 - w_log) * p_elo
    p_match = float(np.clip(p_match, 0.06, 0.94))

    dq = 0.35
    conf = 48.0
    if req.elo_p1 != 1500 or req.elo_p2 != 1500:
        dq = 0.70
        conf = 64.0
    dq = min(0.95, dq + 0.04 * feature_richness)
    conf = min(88.0, conf + 3.5 * feature_richness)
    if req.matches_last_14d_p1 + req.matches_last_14d_p2 > 0:
        conf = min(88.0, conf + 2)
        dq = min(0.95, dq + 0.03)

    factors = [
        f"ensemble w_logistic={w_log:.2f} w_elo={1-w_log:.2f}",
        f"elo {req.elo_p1:.0f} vs {req.elo_p2:.0f} → p_elo={p_elo:.3f}",
        f"logistic p={p_log:.3f}",
        f"features actives={feature_richness}",
    ]
    if req.form_winpct_p1_l5 is not None:
        factors.append(f"form L5 P1={req.form_winpct_p1_l5:.0f}% P2={req.form_winpct_p2_l5 or 0:.0f}%")
    if req.h2h_n:
        factors.append(f"h2h n={req.h2h_n} rate_p1={req.h2h_p1_rate}")
    if req.matches_last_14d_p1 or req.matches_last_14d_p2:
        factors.append(
            f"charge 14j P1={req.matches_last_14d_p1} P2={req.matches_last_14d_p2}"
        )

    return PredictResponse(
        p1_win_match=p_match,
        p1_win_first_set=first_set_prob(p_match),
        expected_total_games=expected_total_games(req.elo_p1, req.elo_p2),
        p_three_sets=p_three_sets(p_match),
        confidence=conf,
        data_quality=dq,
        model="ensemble_elo_logistic_v0.2",
        factors=factors,
        feature_vector=feats,
    )


@app.post("/predict/batch")
def predict_batch(items: list[PredictRequest]):
    return [predict(x) for x in items]
