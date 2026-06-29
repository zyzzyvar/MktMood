# MGR-GO v1

Full name: Macro-Gated Rotation with Guarded-Open Execution v1

Snapshot date: 2026-06-29
Code baseline: 76a3a3e
Production app: MktMood / `/api/positioning`

## Purpose

MGR-GO v1 is the first saved semi-automatic US equity positioning strategy for
the QQQ / MU / EWY / TQQQ universe. It is designed to avoid a fixed all-in
holding pattern by combining a macro market gate, industry relative strength,
event windows, and guarded next-session execution rules.

## Signal Layers

1. Market gate
   - Inputs: SPY trend, QQQ trend, QQQ 200-day trend, VIX vs threshold and
     20-day average, SMH relative strength vs SPY, 10-year Treasury yield
     5-day change.
   - States: `green-rotation`, `event-guard` / `yellow`, `risk-off` / `red`.

2. Target allocation
   - Red: preserve capital, clear TQQQ, raise cash, keep defensive QQQ core.
   - Yellow / event guard: QQQ main sleeve plus limited MU / EWY / TQQQ and
     cash buffer.
   - Green: keep at least 20% QQQ floor, rotate remaining capital toward the
     strongest eligible asset by momentum and industry confirmation.

3. Event guard
   - FOMC, MU earnings, monthly options expiration, and quarter-end windows
     suppress aggressive swing exposure.
   - In event windows, rebalance toward target weights but do not add extra
     swing exposure beyond the model target.

4. Execution
   - Execution profile: `adaptive_guarded_open`.
   - Ignore target/current weight differences below 2 percentage points.
   - Risk reductions are executed before additions.
   - Risk-off and TQQQ reductions prefer the first liquid open window.
   - Additions during event windows, positive gaps, MU, or TQQQ are staged:
     open plus first-hour / VWAP-style execution.

## Saved Parameters

```json
{
  "vixGreen": 22,
  "vixRed": 24,
  "rateJump": 0.25,
  "qqqFloor": 0.2,
  "redCash": 0.25,
  "tqqqCap": 0.18,
  "topConcentration": 0.75,
  "earningsMuCap": 0.25,
  "rebalanceThresholdPct": 2,
  "executionProfile": "adaptive_guarded_open",
  "limitBandsPct": {
    "QQQ": 0.35,
    "MU": 1.0,
    "EWY": 0.6,
    "TQQQ": 1.2
  }
}
```

## Reference Backtest

Backtest script:
`C:/Users/Administrator/Downloads/us_execution_timing_backtest.py`

Output directory:
`C:/Users/Administrator/Downloads/us_execution_timing_output`

Evaluation window:
2026-01-02 to 2026-06-26

Results:

| Model | End value | Return | Max drawdown |
| --- | ---: | ---: | ---: |
| Monthly fixed bucket | 1.8401 | 84.01% | -16.81% |
| Ideal previous-close signal | 2.0796 | 107.96% | -17.96% |
| Next-open execution | 2.1974 | 119.74% | -16.36% |
| Adaptive guarded-open | 2.1859 | 118.59% | -16.36% |

## Current Limitation

This version is dynamic in the sense that it changes targets based on daily
market state, industry strength, and event windows. It is not yet a full
adaptive mechanism system: thresholds are still fixed, state memory is limited,
and validation is not yet walk-forward parameter adaptation.

