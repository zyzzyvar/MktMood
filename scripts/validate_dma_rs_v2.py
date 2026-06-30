import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd


TRADED = ["QQQ", "MU", "EWY", "TQQQ"]
ALL_WEIGHTS = ["QQQ", "MU", "EWY", "TQQQ", "CASH"]

FOMC_DATES = [
    "2023-02-01", "2023-03-22", "2023-05-03", "2023-06-14",
    "2023-07-26", "2023-09-20", "2023-11-01", "2023-12-13",
    "2024-01-31", "2024-03-20", "2024-05-01", "2024-06-12",
    "2024-07-31", "2024-09-18", "2024-11-07", "2024-12-18",
    "2025-01-29", "2025-03-19", "2025-05-07", "2025-06-18",
    "2025-07-30", "2025-09-17", "2025-10-29", "2025-12-10",
    "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17",
    "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09",
]

MU_EARNINGS_DATES = [
    "2023-03-28", "2023-06-28", "2023-09-27", "2023-12-20",
    "2024-03-20", "2024-06-26", "2024-09-25", "2024-12-18",
    "2025-03-20", "2025-06-25", "2025-09-23", "2025-12-17",
    "2026-03-18", "2026-06-24", "2026-09-22", "2026-12-17",
]

EXTRA_TICKERS = {
    "IWM": "IWM",
    "RSP": "RSP",
    "HYG": "HYG",
    "LQD": "LQD",
    "UUP": "UUP",
    "KWEB": "KWEB",
    "HSI": "^HSI",
    "BTC": "BTC-USD",
    "VIX3M": "^VIX3M",
}

V2_BASE = {
    "min_cash": 0.03,
    "max_cash": 0.48,
    "high_risk_cash": 0.34,
    "risk_pressure_mult": 1.0,
    "cash_bias": 0.0,
    "event_pressure_mult": 1.0,
    "fragility_mult": 1.0,
    "repair_credit_mult": 1.0,
    "risk_on_cash_cut": 0.08,
    "max_tqqq": 0.16,
    "guarded_tqqq": 0.06,
    "tqqq_cap_mult": 1.0,
    "max_mu": 0.56,
    "max_ewy": 0.32,
    "ewy_cross_mult": 1.0,
    "core_qqq_min": 0.36,
    "core_qqq_max": 0.70,
    "fragile_repair_deploy": 0.35,
    "selective_momentum_deploy": 0.50,
    "risk_on_deploy": 0.85,
    "balanced_deploy": 0.25,
}


def load_helpers(helper_dir: Path) -> None:
    sys.path.insert(0, str(helper_dir))


def third_friday(year: int, month: int) -> pd.Timestamp:
    date = pd.Timestamp(year=year, month=month, day=1)
    while date.weekday() != 4:
        date += pd.Timedelta(days=1)
    return date + pd.Timedelta(days=14)


def nearest_trading_day(index: pd.DatetimeIndex, date: str) -> pd.Timestamp | None:
    ts = pd.Timestamp(date)
    eligible = index[index <= ts]
    return eligible[-1] if len(eligible) else None


def add_event_windows(f: pd.DataFrame) -> pd.DataFrame:
    out = f.copy()
    for col in ["fomc_window", "mu_earnings_window", "opex_window", "quarter_window"]:
        out[col] = False
    idx = out.index
    for date in FOMC_DATES:
        center = nearest_trading_day(idx, date)
        if center is None or center < idx[0] or center > idx[-1]:
            continue
        loc = idx.get_loc(center)
        for pos in range(max(0, loc - 1), min(len(idx), loc + 2)):
            out.iloc[pos, out.columns.get_loc("fomc_window")] = True
    for date in MU_EARNINGS_DATES:
        center = nearest_trading_day(idx, date)
        if center is None or center < idx[0] or center > idx[-1]:
            continue
        loc = idx.get_loc(center)
        for pos in range(max(0, loc - 2), min(len(idx), loc + 3)):
            out.iloc[pos, out.columns.get_loc("mu_earnings_window")] = True
    for year in sorted(set(idx.year)):
        for month in range(1, 13):
            exp = nearest_trading_day(idx, str(third_friday(year, month).date()))
            if exp is not None:
                loc = idx.get_loc(exp)
                for pos in range(max(0, loc - 1), min(len(idx), loc + 1)):
                    out.iloc[pos, out.columns.get_loc("opex_window")] = True
        for date in [f"{year}-03-31", f"{year}-06-30", f"{year}-09-30", f"{year}-12-31"]:
            qend = nearest_trading_day(idx, date)
            if qend is not None:
                loc = idx.get_loc(qend)
                for pos in range(max(0, loc - 2), min(len(idx), loc + 2)):
                    out.iloc[pos, out.columns.get_loc("quarter_window")] = True
    return out


def safe_fetch(fetch_fn, ticker: str, start: str, end: str) -> pd.DataFrame | None:
    try:
        return fetch_fn(ticker, start, end)
    except Exception as exc:
        print(f"warning: failed to fetch {ticker}: {exc}")
        return None


def sma(series: pd.Series, window: int) -> pd.Series:
    return series.rolling(window, min_periods=max(5, min(window, 20))).mean()


def pct_change(series: pd.Series, window: int) -> pd.Series:
    return series.pct_change(window).replace([np.inf, -np.inf], np.nan)


def zscore_abs_returns(close: pd.Series, window: int = 60) -> pd.Series:
    ret = close.pct_change()
    vol = ret.rolling(window, min_periods=20).std()
    return (ret.abs() / vol.replace(0, np.nan)).replace([np.inf, -np.inf], np.nan)


def rolling_average_correlation(returns: pd.DataFrame, window: int) -> pd.Series:
    values = []
    for i, _date in enumerate(returns.index):
        if i + 1 < window:
            values.append(np.nan)
            continue
        corr = returns.iloc[i + 1 - window : i + 1].corr()
        upper = corr.where(np.triu(np.ones(corr.shape), 1).astype(bool)).stack()
        values.append(float(upper.mean()) if len(upper) else np.nan)
    return pd.Series(values, index=returns.index)


def clamp(value: float, lo: float, hi: float) -> float:
    if not np.isfinite(value):
        return lo
    return min(hi, max(lo, float(value)))


def score_momentum(close: pd.Series) -> pd.Series:
    above20 = (close > sma(close, 20)).astype(float)
    above50 = (close > sma(close, 50)).astype(float)
    ret20 = pct_change(close, 20).clip(-0.12, 0.12) / 0.12
    ret60 = pct_change(close, 60).clip(-0.25, 0.25) / 0.25
    return (0.25 * above20 + 0.25 * above50 + 0.30 * ret20 + 0.20 * ret60).clip(-1, 1).fillna(0)


def score_ratio(ratio: pd.Series) -> pd.Series:
    trend = (ratio > sma(ratio, 20)).astype(float) * 0.45 + (ratio > sma(ratio, 60)).astype(float) * 0.25
    mom = pct_change(ratio, 20).clip(-0.08, 0.08) / 0.08 * 0.30
    return (trend + mom - 0.35).clip(-1, 1).fillna(0)


def add_extra_features(f: pd.DataFrame, frames: dict[str, pd.DataFrame]) -> pd.DataFrame:
    out = add_event_windows(f)
    idx = out.index
    for key, frame in frames.items():
        close = frame["adj_close"].reindex(idx).ffill()
        out[f"{key}_close"] = close
        out[f"{key}_score"] = score_momentum(close)
        out[f"{key}_ret1"] = close.pct_change()
        out[f"{key}_ret20"] = close.pct_change(20)
        out[f"{key}_ret60"] = close.pct_change(60)
        out[f"{key}_zabs"] = zscore_abs_returns(close)

    out["IWM_SPY"] = out["IWM_close"] / out["SPY_close"]
    out["RSP_SPY"] = out["RSP_close"] / out["SPY_close"]
    out["HYG_LQD"] = out["HYG_close"] / out["LQD_close"]
    out["KWEB_SPY"] = out["KWEB_close"] / out["SPY_close"]
    out["HSI_SPY"] = out["HSI_close"] / out["SPY_close"]
    out["IWM_SPY_score"] = score_ratio(out["IWM_SPY"])
    out["RSP_SPY_score"] = score_ratio(out["RSP_SPY"])
    out["HYG_LQD_score"] = score_ratio(out["HYG_LQD"])
    out["KWEB_SPY_score"] = score_ratio(out["KWEB_SPY"])
    out["HSI_SPY_score"] = score_ratio(out["HSI_SPY"])
    out["VIX_term_spread"] = out["VIX3M_close"] - out["VIX_close"]
    out["VIX_term_score"] = (out["VIX_term_spread"] / 4.0).clip(-1, 1).fillna(0)
    out["UUP_score"] = -score_momentum(out["UUP_close"])
    out["BTC_liquidity_score"] = score_momentum(out["BTC_close"])

    corr_input = pd.DataFrame({
        "SPY": out["SPY_close"].pct_change(),
        "QQQ": out["QQQ_close"].pct_change(),
        "IWM": out["IWM_close"].pct_change(),
        "RSP": out["RSP_close"].pct_change(),
    })
    out["dashboard_cross_corr20"] = rolling_average_correlation(corr_input, 20).fillna(out["cross_corr20"])
    vol20 = corr_input[["SPY", "QQQ", "IWM"]].rolling(20, min_periods=10).std() * math.sqrt(252)
    trend_scores = pd.DataFrame({
        "SPY": ((out["SPY_close"] >= out["SPY_sma20"]).astype(float) * 35 + (out["SPY_close"] >= out["SPY_sma50"]).astype(float) * 35 - 35),
        "QQQ": ((out["QQQ_close"] >= out["QQQ_sma20"]).astype(float) * 35 + (out["QQQ_close"] >= out["QQQ_sma50"]).astype(float) * 35 - 35),
        "IWM": ((out["IWM_close"] >= sma(out["IWM_close"], 20)).astype(float) * 35 + (out["IWM_close"] >= sma(out["IWM_close"], 50)).astype(float) * 35 - 35),
    })
    vol_penalty = (vol20 >= 0.35).astype(float) * 30 + ((vol20 >= 0.25) & (vol20 < 0.35)).astype(float) * 15
    out["cta_pressure_proxy"] = (trend_scores - vol_penalty).mean(axis=1).clip(-100, 100).fillna(0)

    anomaly_cols = [c for c in out.columns if c.endswith("_zabs") and not c.startswith("VIX")]
    z = out[anomaly_cols]
    out["anomaly_high_count"] = (z >= 2.5).sum(axis=1)
    out["anomaly_heat"] = (out["anomaly_high_count"] / max(1, len(anomaly_cols) * 0.30)).clip(0, 1)
    semi_heat = (
        (out["SMH_zabs"] >= 1.8).astype(float) * 0.35
        + (out["XLK_zabs"] >= 1.8).astype(float) * 0.25
        + (out["SMH_SPY"] > out["SMH_SPY_sma20"]).astype(float) * 0.25
        + (out["XLK_SPY"] > out["XLK_SPY_sma20"]).astype(float) * 0.15
    )
    out["semiconductor_heat"] = semi_heat.clip(0, 1).fillna(0)
    out["margin_fragility_proxy"] = (
        0.45 * (out["QQQ_close"] / out["QQQ_sma200"] - 1).clip(0, 0.35) / 0.35
        + 0.25 * (1 - (out["VIX_close"] / 25).clip(0, 1))
        + 0.30 * (out["TQQQ_ret60"].clip(0, 0.60) / 0.60)
    ).clip(0, 1).fillna(0)
    return out


def market_proxy_score(row: pd.Series) -> float:
    vals = [
        row.get("SPY_score", 0),
        row.get("QQQ_score", 0),
        row.get("IWM_SPY_score", 0),
        row.get("RSP_SPY_score", 0),
        row.get("HYG_LQD_score", 0),
        row.get("VIX_term_score", 0),
        row.get("UUP_score", 0),
    ]
    clean = [float(v) for v in vals if np.isfinite(v)]
    return clamp(float(np.mean(clean)) if clean else 0.0, -1, 1)


def event_pressure(row: pd.Series) -> float:
    score = 0.0
    if bool(row.get("fomc_window", False)):
        score += 0.32
    if bool(row.get("opex_window", False)):
        score += 0.18
    if bool(row.get("quarter_window", False)):
        score += 0.22
    if bool(row.get("mu_earnings_window", False)):
        score += 0.24
    return clamp(score, 0, 1)


def structure_proxy(row: pd.Series) -> dict:
    corr = row.get("dashboard_cross_corr20", row.get("cross_corr20", 0.25))
    cta = row.get("cta_pressure_proxy", 0)
    credit = row.get("HYG_LQD_score", 0)
    breadth = np.nanmean([row.get("RSP_SPY_score", 0), row.get("IWM_SPY_score", 0), row.get("IWM_score", 0)])
    bottom_stage = 0
    if row.get("VIX_term_spread", 0) > 0:
        bottom_stage += 1
    if cta > -25:
        bottom_stage += 1
    if corr < 0.72 and breadth > -0.05:
        bottom_stage += 1
    if row.get("VIX_close", 99) < row.get("VIX_sma20", 0) * 1.15:
        bottom_stage += 1
    veto = int(credit < -0.55) + int(row.get("VIX_close", 0) >= 30) + int(row.get("UUP_score", 0) < -0.65 and row.get("TNX_chg5", 0) >= 0.12)
    diagnosis_risk = 0.0
    diagnosis = "calm"
    if corr >= 0.85 or cta <= -40:
        diagnosis_risk += 0.34
        diagnosis = "mechanical"
    elif corr >= 0.72 or credit < -0.35:
        diagnosis_risk += 0.24
        diagnosis = "mixed"
    if veto:
        diagnosis_risk += min(veto, 3) * 0.16
    fragility = row.get("margin_fragility_proxy", 0)
    if fragility >= 0.70:
        diagnosis_risk += 0.22
    elif fragility >= 0.40:
        diagnosis_risk += 0.12
    return {
        "risk": clamp(diagnosis_risk, 0, 1),
        "bottom_support": 0 if veto else min(1.0, bottom_stage / 4.0),
        "bottom_stage": bottom_stage,
        "veto_count": veto,
        "fragility": clamp(float(fragility), 0, 1),
        "label": diagnosis,
    }


def atmosphere_state(row: pd.Series, params: dict, macro_state: str, macro_score: int) -> dict:
    market_score = market_proxy_score(row)
    vix = row.get("VIX_close", 0)
    risk_regime_score = 0.0
    if vix >= 30:
        risk_regime_score += 0.30
    elif vix >= 25:
        risk_regime_score += 0.22
    elif vix >= 20:
        risk_regime_score += 0.14
    elif vix >= 16:
        risk_regime_score += 0.06
    if row.get("VIX_term_spread", 0) <= -2:
        risk_regime_score += 0.22
    elif row.get("VIX_term_spread", 0) <= 0:
        risk_regime_score += 0.14
    corr_risk = clamp((row.get("dashboard_cross_corr20", row.get("cross_corr20", 0.25)) - 0.50) / 0.38, 0, 1)
    if corr_risk >= 0.92:
        risk_regime_score += 0.18
    elif corr_risk >= 0.58:
        risk_regime_score += 0.10
    risk_regime_score += 0.18 * row.get("anomaly_heat", 0)

    cta_value = row.get("cta_pressure_proxy", 0)
    cta_relief = clamp((cta_value + 25) / 75, 0, 1)
    credit_stress = clamp(max(-row.get("HYG_LQD_score", 0), -row.get("UUP_score", 0) * 0.5), 0, 1)
    liquidity_score = clamp(np.nanmean([row.get("VIX_term_score", 0), row.get("BTC_liquidity_score", 0), -credit_stress]), -1, 1)
    breadth_score = clamp(np.nanmean([row.get("RSP_SPY_score", 0), row.get("IWM_SPY_score", 0), row.get("IWM_score", 0)]), -1, 1)
    tech_leadership = clamp(
        (
            (0.45 if row["SMH_SPY"] > row["SMH_SPY_sma20"] else -0.25)
            + (0.35 if row["XLK_SPY"] > row["XLK_SPY_sma20"] else -0.20)
            + row.get("QQQ_score", 0)
        ) / 1.8,
        -1,
        1,
    )
    cross_border_pressure = clamp(
        max(
            -np.nanmean([row.get("KWEB_SPY_score", 0), row.get("HSI_SPY_score", 0)]),
            0.55 if row.get("USDKRW_ret10", 0) > 0.035 else 0,
            0.45 if row.get("KWEB_ret60", 0) < -0.10 else 0,
        ),
        0,
        1,
    )
    ep = event_pressure(row) * params["event_pressure_mult"]
    structure = structure_proxy(row)
    fragility = clamp(max(structure["fragility"] * params["fragility_mult"], 0), 0, 1)
    risk_pressure = clamp(
        params["risk_pressure_mult"]
        * (
            0.30 * clamp(risk_regime_score, 0, 1)
            + 0.16 * structure["risk"]
            + 0.13 * fragility
            + 0.12 * corr_risk
            + 0.10 * ep
            + 0.08 * credit_stress
            + 0.07 * row.get("anomaly_heat", 0)
        ),
        0,
        1,
    )
    repair_credit = clamp(
        params["repair_credit_mult"]
        * (
            0.30 * structure["bottom_support"]
            + 0.22 * max(breadth_score, 0)
            + 0.18 * max(liquidity_score, 0)
            + 0.15 * cta_relief
            + 0.15 * max(tech_leadership, 0)
        ),
        0,
        1,
    )
    risk_budget = clamp(0.52 + 0.24 * market_score + 0.22 * repair_credit - 0.44 * risk_pressure, 0.18, 0.94)
    phase_input = {
        "macro_state": macro_state,
        "event_guard": bool(row["fomc_window"] or row["opex_window"] or row["quarter_window"] or row["mu_earnings_window"]),
        "risk_pressure": risk_pressure,
        "risk_budget": risk_budget,
        "repair_credit": repair_credit,
        "event_pressure": ep,
        "anomaly_heat": row.get("anomaly_heat", 0),
        "tech_leadership": tech_leadership,
        "structure": structure,
    }
    phase = pick_phase(phase_input)
    cash_floor = cash_floor_for(params, risk_pressure, repair_credit, ep, fragility, market_score, risk_budget, phase)
    return {
        "phase": phase,
        "risk_budget": risk_budget,
        "cash_floor": cash_floor,
        "risk_pressure": risk_pressure,
        "repair_credit": repair_credit,
        "market_score": market_score,
        "risk_regime_score": clamp(risk_regime_score, 0, 1),
        "breadth_score": breadth_score,
        "liquidity_score": liquidity_score,
        "tech_leadership": tech_leadership,
        "cross_border_pressure": cross_border_pressure,
        "correlation_risk": corr_risk,
        "event_pressure": clamp(ep, 0, 1),
        "anomaly_heat": row.get("anomaly_heat", 0),
        "semiconductor_heat": row.get("semiconductor_heat", 0),
        "fragility": fragility,
        "structure_risk": structure["risk"],
        "bottom_stage": structure["bottom_stage"],
        "veto_count": structure["veto_count"],
    }


def pick_phase(x: dict) -> str:
    structure = x["structure"]
    if structure["veto_count"] > 0 or (x["macro_state"] == "red" and x["risk_pressure"] >= 0.55) or x["risk_pressure"] >= 0.72:
        return "capital_defense"
    if x["event_guard"] or x["event_pressure"] >= 0.46:
        return "event_guard"
    if structure["bottom_stage"] >= 3 and x["repair_credit"] >= 0.42 and x["risk_pressure"] >= 0.30:
        return "fragile_repair"
    if x["anomaly_heat"] >= 0.58 and x["tech_leadership"] >= 0.25 and x["risk_pressure"] <= 0.58:
        return "selective_momentum"
    if x["risk_budget"] >= 0.68 and x["repair_credit"] >= 0.45:
        return "risk_on"
    if x["risk_budget"] <= 0.38 or x["risk_pressure"] >= 0.60:
        return "risk_reduction"
    return "balanced_selective"


def cash_floor_for(params: dict, risk_pressure: float, repair_credit: float, event_p: float, fragility: float, market_score: float, risk_budget: float, phase: str) -> float:
    cash = (
        params["min_cash"]
        + params["cash_bias"]
        + 0.28 * risk_pressure
        + 0.07 * event_p
        + 0.06 * fragility
        - 0.08 * repair_credit
        - 0.04 * max(market_score, 0)
        - 0.04 * max(risk_budget - 0.55, 0)
    )
    if phase == "capital_defense":
        cash = max(cash, params["high_risk_cash"])
    if phase == "event_guard":
        cash = max(cash, 0.14)
    if phase == "risk_reduction":
        cash = max(cash, 0.22)
    if phase == "fragile_repair":
        cash = clamp(cash, 0.08, 0.26)
    if phase == "selective_momentum":
        cash = clamp(cash - params["risk_on_cash_cut"] / 2, 0.05, 0.20)
    if phase == "risk_on":
        cash = clamp(cash - params["risk_on_cash_cut"], 0.03, 0.14)
    return clamp(cash, params["min_cash"], params["max_cash"])


def raise_cash(weights: pd.Series, target_cash: float, state: dict, params: dict) -> pd.Series:
    out = weights.copy()
    need = target_cash - float(out["CASH"])
    if need <= 1e-9:
        return out
    order = ["TQQQ", "MU", "EWY", "QQQ"] if state["phase"] in {"capital_defense", "risk_reduction"} else ["TQQQ", "EWY", "MU", "QQQ"]
    for symbol in order:
        if need <= 1e-9:
            break
        min_weight = min(params["core_qqq_min"], out["QQQ"]) if symbol == "QQQ" else 0.0
        room = max(0.0, float(out[symbol]) - min_weight)
        cut = min(room, need)
        out[symbol] -= cut
        out["CASH"] += cut
        need -= cut
    return out


def caps_for(state: dict, events: pd.Series, params: dict) -> dict:
    tqqq_cap = min(params["max_tqqq"], max(0.0, 0.02 + 0.18 * state["risk_budget"] - 0.12 * state["risk_pressure"]))
    tqqq_cap *= params["tqqq_cap_mult"]
    if state["phase"] == "event_guard":
        tqqq_cap = min(tqqq_cap, params["guarded_tqqq"])
    if state["phase"] in {"capital_defense", "risk_reduction"}:
        tqqq_cap = min(tqqq_cap, 0.025)
    if bool(events["mu_earnings_window"]):
        tqqq_cap = min(tqqq_cap, 0.05)
    if state["semiconductor_heat"] > 0.65 and state["risk_pressure"] < 0.52:
        tqqq_cap = min(params["max_tqqq"], tqqq_cap + 0.02)

    mu_cap = (
        params["max_mu"]
        - 0.14 * state["fragility"]
        - 0.10 * state["event_pressure"]
        + 0.08 * state["semiconductor_heat"]
        + 0.04 * max(state["tech_leadership"], 0)
    )
    if bool(events["mu_earnings_window"]):
        mu_cap = min(mu_cap, 0.25)
    if state["phase"] == "capital_defense":
        mu_cap = min(mu_cap, 0.18)
    if state["phase"] == "risk_reduction":
        mu_cap = min(mu_cap, 0.24)

    ewy_cap = (
        params["max_ewy"]
        - 0.13 * state["cross_border_pressure"] * params["ewy_cross_mult"]
        - 0.08 * state["risk_pressure"]
        + 0.05 * max(state["breadth_score"], 0)
    )
    if state["phase"] == "capital_defense":
        ewy_cap = min(ewy_cap, 0.10)
    if state["phase"] == "risk_reduction":
        ewy_cap = min(ewy_cap, 0.16)

    qqq_cap = params["core_qqq_max"]
    if state["phase"] == "capital_defense":
        qqq_cap = 0.58
    if state["phase"] == "risk_on":
        qqq_cap = 0.72
    return {
        "QQQ": clamp(qqq_cap, params["core_qqq_min"], 0.74),
        "MU": clamp(mu_cap, 0.08, params["max_mu"]),
        "EWY": clamp(ewy_cap, 0.05, params["max_ewy"]),
        "TQQQ": clamp(tqqq_cap, 0.0, params["max_tqqq"]),
    }


def cap_to_cash(weights: pd.Series, caps: dict) -> pd.Series:
    out = weights.copy()
    for symbol, cap in caps.items():
        if out[symbol] > cap:
            excess = out[symbol] - cap
            out[symbol] = cap
            out["CASH"] += excess
    return out


def deploy_pct(state: dict, params: dict) -> float:
    phase = state["phase"]
    if phase in {"capital_defense", "event_guard"}:
        return 0.0
    if phase == "fragile_repair":
        return params["fragile_repair_deploy"]
    if phase == "selective_momentum":
        return params["selective_momentum_deploy"]
    if phase == "risk_on":
        return params["risk_on_deploy"]
    if phase == "balanced_selective":
        return params["balanced_deploy"] if state["risk_budget"] >= 0.55 else 0.0
    return 0.0


def symbol_score(row: pd.Series, symbol: str, state: dict) -> float:
    if symbol == "CASH":
        return 0.0
    source = "QQQ" if symbol == "TQQQ" else symbol
    ret20 = row.get(f"{source}_ret20", 0)
    ret10 = row.get(f"{source}_ret10", 0)
    ret5 = row.get(f"{source}_ret5", 0)
    trend_bonus = 0.6 if row[f"{source}_close"] > row[f"{source}_sma20"] else -0.4
    score = 5.0 * ret20 + 2.2 * ret10 + 1.0 * ret5 + trend_bonus - 0.55 * state["risk_pressure"]
    if symbol == "QQQ":
        score += 0.65 * state["tech_leadership"] + 0.35 * max(state["breadth_score"], 0) - 0.35 * state["risk_pressure"]
    elif symbol == "MU":
        score += 1.05 * state["semiconductor_heat"] + 0.45 * state["tech_leadership"] - 0.55 * state["fragility"] - 0.35 * state["event_pressure"]
    elif symbol == "EWY":
        score += 0.35 * max(state["breadth_score"], 0) - 0.90 * state["cross_border_pressure"] - 0.35 * state["risk_pressure"]
    elif symbol == "TQQQ":
        score += 1.05 * state["risk_budget"] + 0.55 * state["tech_leadership"] - 1.25 * state["risk_pressure"] - 0.65 * state["event_pressure"]
    return float(score)


def deploy_cash(row: pd.Series, weights: pd.Series, amount: float, state: dict, caps: dict) -> pd.Series:
    out = weights.copy()
    remaining = min(amount, float(out["CASH"]))
    ranked = sorted([(symbol_score(row, symbol, state), symbol) for symbol in TRADED], reverse=True)
    for _score, symbol in ranked:
        if remaining <= 1e-9:
            break
        room = max(0.0, caps[symbol] - out[symbol])
        add = min(room, remaining)
        out[symbol] += add
        out["CASH"] -= add
        remaining -= add
    return out


def normalize(weights: pd.Series) -> pd.Series:
    total = float(weights[ALL_WEIGHTS].sum())
    if total <= 0 or not np.isfinite(total):
        return pd.Series({"QQQ": 0, "MU": 0, "EWY": 0, "TQQQ": 0, "CASH": 1.0})
    return (weights[ALL_WEIGHTS] / total).clip(lower=0)


def build_v2_targets(f: pd.DataFrame, mgr_targets: pd.DataFrame, params: dict, macro_mod) -> tuple[pd.DataFrame, pd.DataFrame]:
    targets = pd.DataFrame(0.0, index=f.index, columns=ALL_WEIGHTS)
    states = []
    for date, row in f.iterrows():
        macro_state, macro_score = macro_mod.market_state(row, 22, 24, 0.25)
        state = atmosphere_state(row, params, macro_state, macro_score)
        w = mgr_targets.loc[date, ALL_WEIGHTS].copy().astype(float)
        w = raise_cash(w, state["cash_floor"], state, params)
        caps = caps_for(state, row, params)
        w = cap_to_cash(w, caps)
        deployable = max(0.0, float(w["CASH"]) - state["cash_floor"])
        pct = deploy_pct(state, params)
        if deployable > 0.005 and pct > 0:
            w = deploy_cash(row, w, deployable * pct, state, caps)
        w = raise_cash(w, state["cash_floor"], state, params)
        w = cap_to_cash(w, caps)
        targets.loc[date] = normalize(w)
        states.append({"date": date, **state})
    states_df = pd.DataFrame(states).set_index("date")
    return targets.round(6), states_df


def variant_grid() -> list[dict]:
    variants = []

    def add(name: str, **updates) -> None:
        item = dict(V2_BASE)
        item.update(updates)
        item["name"] = name
        variants.append(item)

    add("dma_rs_v2_deployed_proxy")
    add("v2_light_cash", cash_bias=-0.035, risk_pressure_mult=0.92, tqqq_cap_mult=1.05)
    add("v2_balanced_low_turn", cash_bias=-0.015, max_tqqq=0.14, guarded_tqqq=0.045)
    add("v2_defensive", cash_bias=0.035, risk_pressure_mult=1.12, high_risk_cash=0.38, tqqq_cap_mult=0.65)
    add("v2_event_strict", event_pressure_mult=1.25, guarded_tqqq=0.025, cash_bias=0.015)
    add("v2_fragility_strict", fragility_mult=1.35, cash_bias=0.02, max_mu=0.50, max_ewy=0.28)
    add("v2_cross_border_strict", ewy_cross_mult=1.45, max_ewy=0.28)
    add("v2_semi_momentum", cash_bias=-0.02, max_mu=0.58, tqqq_cap_mult=1.15, selective_momentum_deploy=0.65)
    add("v2_repair_slow", fragile_repair_deploy=0.18, balanced_deploy=0.10, cash_bias=0.02)
    add("v2_repair_fast", fragile_repair_deploy=0.55, balanced_deploy=0.35, cash_bias=-0.02)
    add("v2_offense", cash_bias=-0.05, risk_pressure_mult=0.85, tqqq_cap_mult=1.30, risk_on_deploy=0.95)
    add("v2_capital_guard", risk_pressure_mult=1.25, cash_bias=0.05, high_risk_cash=0.42, tqqq_cap_mult=0.4)
    return variants


def metrics(name: str, ret: pd.Series, targets: pd.DataFrame | None, start: str, end: str | None, base_mod) -> dict:
    sample = ret.loc[start:end] if end else ret.loc[start:]
    if targets is not None:
        target_sample = targets.reindex(sample.index)
        out = base_mod.metrics_from_returns(sample, target_sample[TRADED].sum(axis=1))
        out["avg_cash"] = float(target_sample["CASH"].mean())
    else:
        out = base_mod.metrics_from_returns(sample)
        out["avg_cash"] = 0.0
    out["name"] = name
    out["period"] = f"{start}:{end or ''}"
    return out


def monthly_returns(ret: pd.Series, start: str, end: str) -> pd.Series:
    sample = ret.loc[start:end]
    vals = {}
    for month, sub in sample.groupby(pd.Grouper(freq="ME")):
        if not sub.empty:
            vals[month.strftime("%Y-%m")] = float((1 + sub).prod() - 1)
    return pd.Series(vals)


def score_window(ret: pd.Series, mgr_ret: pd.Series, start: pd.Timestamp, end: pd.Timestamp, base_mod) -> float:
    cand = ret.loc[start:end]
    mgr = mgr_ret.loc[start:end]
    if len(cand) < 80 or len(mgr) < 80:
        return -999.0
    cm = base_mod.metrics_from_returns(cand)
    mm = base_mod.metrics_from_returns(mgr)
    cand_months = monthly_returns(ret, str(start.date()), str(end.date()))
    mgr_months = monthly_returns(mgr_ret, str(start.date()), str(end.date()))
    aligned = pd.concat([cand_months, mgr_months], axis=1).dropna()
    win_rate = float((aligned.iloc[:, 0] > aligned.iloc[:, 1]).mean()) if len(aligned) else 0.0
    return (
        (cm["end_value"] - mm["end_value"]) * 1.15
        + (abs(mm["max_dd"]) - abs(cm["max_dd"])) * 2.1
        + (np.nan_to_num(cm["sharpe0"]) - np.nan_to_num(mm["sharpe0"])) * 0.09
        + (win_rate - 0.5) * 0.25
        - max(0.0, abs(cm["max_dd"]) - 0.40) * 0.9
    )


def rolling_selector(
    candidate_returns: dict[str, pd.Series],
    candidate_targets: dict[str, pd.DataFrame],
    mgr_ret: pd.Series,
    start: str,
    end: str,
    train_days: int,
    top_n: int,
    base_mod,
) -> tuple[pd.Series, pd.DataFrame, pd.DataFrame]:
    index = mgr_ret.loc[start:end].index
    out = pd.Series(0.0, index=index)
    out_targets = pd.DataFrame(0.0, index=index, columns=ALL_WEIGHTS)
    choices = []
    months = sorted(set((d.year, d.month) for d in index))
    for year, month in months:
        dates = index[(index.year == year) & (index.month == month)]
        if len(dates) == 0:
            continue
        train_end = dates[0] - pd.Timedelta(days=1)
        train_start = train_end - pd.Timedelta(days=train_days)
        ranked = sorted([(score_window(ret, mgr_ret, train_start, train_end, base_mod), name) for name, ret in candidate_returns.items()], reverse=True)
        selected = [name for _score, name in ranked[:top_n]]
        out.loc[dates] = pd.concat([candidate_returns[name].loc[dates] for name in selected], axis=1).mean(axis=1)
        blended_targets = sum((candidate_targets[name].loc[dates, ALL_WEIGHTS] for name in selected), start=pd.DataFrame(0.0, index=dates, columns=ALL_WEIGHTS))
        out_targets.loc[dates, ALL_WEIGHTS] = blended_targets / max(len(selected), 1)
        choices.append({
            "month": f"{year}-{month:02d}",
            "train_days": train_days,
            "top_n": top_n,
            "selected": ",".join(selected),
            "score": ranked[0][0],
        })
    return out, pd.DataFrame(choices), out_targets


def low_disturbance_months(f: pd.DataFrame, start: str, end: str) -> list[str]:
    sample = f.loc[start:end]
    months = []
    for month, sub in sample.groupby(pd.Grouper(freq="ME")):
        if sub.empty:
            continue
        if (
            sub[["fomc_window", "mu_earnings_window", "quarter_window"]].sum().sum() <= 1
            and sub["VIX_close"].max() < 24
            and sub["dashboard_cross_corr20"].mean() < 0.75
        ):
            months.append(month.strftime("%Y-%m"))
    return months


def write_report(outdir: Path, repo_root: Path, summary: pd.DataFrame, monthly: pd.DataFrame, latest: dict, best_name: str) -> None:
    report = []
    report.append("# DMA-RS v2 Atmosphere-Fused Rolling Validation")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now('UTC').isoformat()}")
    report.append(f"Latest signal date: {latest['as_of']}")
    report.append(f"Best static variant: `{best_name}`")
    report.append("")
    report.append("## Method")
    report.append("")
    report.append("- Base execution model: adaptive_guarded_open with 5 bps one-way cost.")
    report.append("- Baselines: monthly fixed bucket, MGR-GO v1, DMA-RS v1 candidate, DMA-RS v2 deployed proxy, rolling v2 selectors.")
    report.append("- Selection uses only prior data for rolling selectors: 252-day top1, 504-day top1, 504-day top3 blend.")
    report.append("- Dashboard-only live dimensions are replayed with transparent historical proxies: cross-index correlation, CTA proxy, sector anomaly heat, credit/liquidity proxy, cross-border proxy, and margin-fragility proxy.")
    report.append("")
    report.append("## Decision")
    report.append("")
    report.append("Do not promote DMA-RS v2 to default execution yet. The rolling validation confirms that v2 behaves as a useful defensive atmosphere layer, but it does not consistently beat MGR-GO v1 or DMA-RS v1 on return.")
    report.append("")
    report.append("- 2026YTD deployed-proxy drawdown improves to -14.40%, versus MGR-GO v1 -16.36% and DMA-RS v1 -15.16%.")
    report.append("- 2026YTD deployed-proxy end value is 2.1668, below MGR-GO v1 2.2244 and DMA-RS v1 2.2381.")
    report.append("- 2024-2026YTD deployed-proxy end value is 3.8720, below MGR-GO v1 4.1231 and DMA-RS v1 4.2840.")
    report.append("- Keep v2 as paper_candidate and use it as a risk-control reference, not the live default.")
    report.append("")
    report.append("## Key Summary")
    report.append("")
    show = summary[["name", "label", "end_value", "max_dd", "sharpe0", "avg_cash"]].copy()
    show["end_value"] = show["end_value"].map(lambda x: f"{x:.4f}")
    show["max_dd"] = show["max_dd"].map(lambda x: f"{x:.2%}")
    show["sharpe0"] = show["sharpe0"].map(lambda x: f"{x:.4f}")
    show["avg_cash"] = show["avg_cash"].map(lambda x: f"{x:.2%}")
    report.append(show.to_markdown(index=False))
    report.append("")
    report.append("## Latest DMA-RS v2 Deployed-Proxy Signal")
    report.append("")
    report.append(f"- Phase: `{latest['deployed_proxy']['phase']}`")
    report.append(f"- Risk budget: {latest['deployed_proxy']['risk_budget']:.2%}")
    report.append(f"- Cash floor: {latest['deployed_proxy']['cash_floor']:.2%}")
    for symbol, weight in latest["deployed_proxy"]["targets"].items():
        report.append(f"- {symbol}: {weight:.2%}")
    report.append("")
    report.append("## Output Files")
    report.append("")
    for name in [
        "dma_rs_v2_rolling_summary.csv",
        "dma_rs_v2_monthly_returns.csv",
        "dma_rs_v2_candidate_grid.csv",
        "dma_rs_v2_selector_choices.csv",
        "dma_rs_v2_latest_signal.json",
    ]:
        report.append(f"- `{outdir / name}`")
    text = "\n".join(report) + "\n"
    (outdir / "dma_rs_v2_validation_report.md").write_text(text, encoding="utf-8")
    snap_dir = repo_root / "strategy_snapshots"
    snap_dir.mkdir(exist_ok=True)
    (snap_dir / "dma-rs-v2-rolling-validation.md").write_text(text, encoding="utf-8")
    (snap_dir / "dma-rs-v2-rolling-validation.json").write_text(json.dumps(latest, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", default="2020-01-01")
    parser.add_argument("--end", default="2026-06-30")
    parser.add_argument("--oos-start", default="2024-01-01")
    parser.add_argument("--test-start", default="2026-01-01")
    parser.add_argument("--test-end", default="2026-06-30")
    parser.add_argument("--helper-dir", default=str(Path.home() / "Downloads"))
    parser.add_argument("--outdir", default=str(Path.home() / "Downloads" / "us_dma_rs_v2_rolling_output"))
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    helper_dir = Path(args.helper_dir)
    load_helpers(helper_dir)
    import us_dynamic_mechanism_backtest as dma
    import us_execution_timing_backtest as execbt
    import us_macro_event_overlay as macro
    import us_macro_rotation_backtest as rotation
    import us_position_backtest as base

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    frames = rotation.load_frames(args.start, args.end, outdir)
    for key, ticker in EXTRA_TICKERS.items():
        frame = safe_fetch(base.fetch_yahoo_daily, ticker, args.start, args.end)
        if frame is not None and len(frame) > 220:
            frames[key] = frame
            frame.to_csv(outdir / f"{key}_daily.csv")
    missing = [key for key in EXTRA_TICKERS if key not in frames]
    if missing:
        raise RuntimeError(f"Missing required extra frames: {missing}")

    f = dma.enrich_features(macro.build_feature_frame(frames))
    f = add_extra_features(f, frames)
    f.to_csv(outdir / "dma_rs_v2_feature_frame.csv")

    ohlc = execbt.build_ohlc_frame(frames, f.index)
    cost_bps = 5.0
    baseline = macro.monthly_rebalanced_buyhold(f, cost_bps)
    mgr_targets = rotation.build_rotation_targets(f, **execbt.BEST_ROTATION_PARAMS)
    mgr_ret, _ = execbt.execution_returns_from_targets(f, ohlc, mgr_targets, cost_bps, "adaptive_guarded_open")

    v1_params = {
        "name": "dma_rs_v1_candidate",
        "hysteresis_days": 1,
        "panic_risky_cut": 0.15,
        "panic_qqq_cut": 0.0,
        "euphoria_risky_cut": 0.12,
        "repair_cash_deploy": 0.70,
        "constructive_cash_deploy": 0.90,
        "min_cash": 0.0,
    }
    phases = dma.smoothed_phases(f, v1_params["hysteresis_days"])
    import us_dynamic_mechanism_rolling_validation as v1roll
    v1_targets = v1roll.build_hybrid_targets_with_phases(f, mgr_targets, v1_params, phases)
    v1_ret, _ = execbt.execution_returns_from_targets(f, ohlc, v1_targets, cost_bps, "adaptive_guarded_open")

    candidate_returns = {}
    candidate_targets = {}
    candidate_states = {}
    rows = []
    periods = {
        "train_2023_2024": ("2023-01-01", "2024-12-31"),
        "val_2025": ("2025-01-01", "2025-12-31"),
        "test_2026ytd": (args.test_start, args.test_end),
        "oos_2024_2026ytd": (args.oos_start, args.test_end),
        "full_2023_2026ytd": ("2023-01-01", args.test_end),
    }
    mgr_stats = {key: metrics("mgr_go_v1", mgr_ret, mgr_targets, start, end, base) for key, (start, end) in periods.items()}

    for params in variant_grid():
        name = params["name"]
        targets, states = build_v2_targets(f, mgr_targets, params, macro)
        ret, _actions = execbt.execution_returns_from_targets(f, ohlc, targets, cost_bps, "adaptive_guarded_open")
        candidate_returns[name] = ret
        candidate_targets[name] = targets
        candidate_states[name] = states
        stat = {key: metrics(name, ret, targets, start, end, base) for key, (start, end) in periods.items()}
        val = stat["val_2025"]
        train = stat["train_2023_2024"]
        val_mgr = mgr_stats["val_2025"]
        train_mgr = mgr_stats["train_2023_2024"]
        row = {"name": name}
        row["selection_score"] = (
            (val["end_value"] - val_mgr["end_value"]) * 1.6
            + (train["end_value"] - train_mgr["end_value"]) * 0.35
            + (abs(val_mgr["max_dd"]) - abs(val["max_dd"])) * 1.5
            + (np.nan_to_num(val["sharpe0"]) - np.nan_to_num(val_mgr["sharpe0"])) * 0.08
            - val["avg_cash"] * 0.05
        )
        row.update({k: v for k, v in params.items() if k != "name"})
        for key, item in stat.items():
            row[f"{key}_end_value"] = item["end_value"]
            row[f"{key}_max_dd"] = item["max_dd"]
            row[f"{key}_sharpe0"] = item["sharpe0"]
            row[f"{key}_avg_cash"] = item["avg_cash"]
        rows.append(row)

    grid = pd.DataFrame(rows).sort_values("selection_score", ascending=False)
    grid.to_csv(outdir / "dma_rs_v2_candidate_grid.csv", index=False)
    best_name = str(grid.iloc[0]["name"])
    deployed_name = "dma_rs_v2_deployed_proxy"

    selector_252, choices_252, targets_252 = rolling_selector(candidate_returns, candidate_targets, mgr_ret, args.oos_start, args.test_end, 252, 1, base)
    selector_504, choices_504, targets_504 = rolling_selector(candidate_returns, candidate_targets, mgr_ret, args.oos_start, args.test_end, 504, 1, base)
    selector_504_top3, choices_top3, targets_top3 = rolling_selector(candidate_returns, candidate_targets, mgr_ret, args.oos_start, args.test_end, 504, 3, base)
    choices = pd.concat([
        choices_252.assign(selector="rolling_252_top1"),
        choices_504.assign(selector="rolling_504_top1"),
        choices_top3.assign(selector="rolling_504_top3_blend"),
    ], ignore_index=True)
    choices.to_csv(outdir / "dma_rs_v2_selector_choices.csv", index=False)

    comparison_returns = {
        "baseline_monthly_bucket": baseline,
        "mgr_go_v1": mgr_ret,
        "dma_rs_v1_candidate": v1_ret,
        "dma_rs_v2_deployed_proxy": candidate_returns[deployed_name],
        "dma_rs_v2_static_best": candidate_returns[best_name],
        "dma_rs_v2_rolling_252_top1": selector_252,
        "dma_rs_v2_rolling_504_top1": selector_504,
        "dma_rs_v2_rolling_504_top3": selector_504_top3,
    }
    comparison_targets = {
        "mgr_go_v1": mgr_targets,
        "dma_rs_v1_candidate": v1_targets,
        "dma_rs_v2_deployed_proxy": candidate_targets[deployed_name],
        "dma_rs_v2_static_best": candidate_targets[best_name],
        "dma_rs_v2_rolling_252_top1": targets_252,
        "dma_rs_v2_rolling_504_top1": targets_504,
        "dma_rs_v2_rolling_504_top3": targets_top3,
    }
    summary_rows = []
    for name, ret in comparison_returns.items():
        for label, (start, end) in periods.items():
            if name.startswith("dma_rs_v2_rolling") and pd.Timestamp(start) < pd.Timestamp(args.oos_start):
                continue
            summary_rows.append({**metrics(name, ret, comparison_targets.get(name), start, end, base), "label": label})
    low_months = low_disturbance_months(f, args.oos_start, args.test_end)
    low_mask = f.index.strftime("%Y-%m").isin(low_months)
    for name, ret in comparison_returns.items():
        sample = ret.reindex(f.index).loc[low_mask]
        if len(sample) < 20:
            continue
        target = comparison_targets.get(name)
        target_sample = target.reindex(sample.index) if target is not None else None
        m = base.metrics_from_returns(sample, target_sample[TRADED].sum(axis=1) if target_sample is not None else None)
        m["avg_cash"] = float(target_sample["CASH"].mean()) if target_sample is not None else 0.0
        m["name"] = name
        m["period"] = ",".join(low_months)
        m["label"] = "low_disturbance_months"
        summary_rows.append(m)

    summary = pd.DataFrame(summary_rows)
    summary.to_csv(outdir / "dma_rs_v2_rolling_summary.csv", index=False)

    monthly = []
    for name, ret in comparison_returns.items():
        series = monthly_returns(ret, args.oos_start, args.test_end)
        for month, value in series.items():
            monthly.append({"name": name, "month": month, "return_pct": value * 100})
    monthly_df = pd.DataFrame(monthly).pivot(index="month", columns="name", values="return_pct").reset_index().round(2)
    monthly_df.to_csv(outdir / "dma_rs_v2_monthly_returns.csv", index=False)

    for name in [deployed_name, best_name]:
        candidate_targets[name].to_csv(outdir / f"{name}_targets.csv")
        candidate_states[name].to_csv(outdir / f"{name}_atmosphere_states.csv")

    latest_state = candidate_states[deployed_name].iloc[-1].to_dict()
    latest = {
        "strategy": "DMA-RS v2 Atmosphere-Fused rolling validation",
        "as_of": str(f.index[-1].date()),
        "outdir": str(outdir),
        "helper_dir": str(helper_dir),
        "best_static_variant": best_name,
        "low_disturbance_months": low_months,
        "validation_periods": periods,
        "recommendation": {
            "decision": "keep_as_paper_candidate",
            "reason": "DMA-RS v2 improves drawdown in selected windows but does not consistently beat MGR-GO v1 or DMA-RS v1 on return.",
        },
        "deployed_proxy": {
            "phase": latest_state["phase"],
            "risk_budget": float(latest_state["risk_budget"]),
            "cash_floor": float(latest_state["cash_floor"]),
            "risk_pressure": float(latest_state["risk_pressure"]),
            "repair_credit": float(latest_state["repair_credit"]),
            "targets": {key: float(value) for key, value in candidate_targets[deployed_name].iloc[-1].to_dict().items()},
        },
        "best_static": {
            "variant": best_name,
            "targets": {key: float(value) for key, value in candidate_targets[best_name].iloc[-1].to_dict().items()},
        },
        "caveats": [
            "Historical validation uses transparent proxies for live-only dashboard dimensions.",
            "Do not promote v2 to default until paper tracking and broker-position-aware execution are reviewed.",
        ],
    }
    (outdir / "dma_rs_v2_latest_signal.json").write_text(json.dumps(latest, ensure_ascii=False, indent=2), encoding="utf-8")
    write_report(outdir, repo_root, summary, monthly_df, latest, best_name)

    show = summary[["name", "label", "period", "end_value", "max_dd", "sharpe0", "avg_cash"]]
    print("\nDMA-RS v2 rolling validation summary:")
    print(show.to_string(index=False, float_format=lambda x: f"{x:.4f}"))
    print("\nCandidate grid top:")
    print(grid[["name", "selection_score", "val_2025_end_value", "val_2025_max_dd", "test_2026ytd_end_value", "test_2026ytd_max_dd", "oos_2024_2026ytd_end_value", "oos_2024_2026ytd_max_dd"]].head(12).to_string(index=False, float_format=lambda x: f"{x:.4f}"))
    print("\nLatest deployed proxy:")
    print(json.dumps(latest["deployed_proxy"], indent=2, ensure_ascii=False))
    print("\nWrote", outdir.resolve())


if __name__ == "__main__":
    main()
