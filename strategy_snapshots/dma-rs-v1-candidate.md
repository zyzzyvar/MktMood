# DMA-RS v1 Candidate

Full name: Dynamic Market Atmosphere Regime System v1

Status: research candidate, not deployed
Snapshot date: 2026-06-29
Baseline strategy: MGR-GO v1

## Why This Version Exists

MGR-GO v1 already works as a strong dynamic rules strategy. DMA-RS v1 keeps
MGR-GO v1 as the base allocation engine and adds a lightweight market-atmosphere
state overlay. The goal is not to replace the profitable base logic, but to
adjust exposure when the market enters panic, repair, constructive, euphoric,
or event-guard states.

The strict validation winner is:

`mgr_dma_micro_overlay__eu0p12`

## Mechanism

DMA-RS v1 uses the same universe as MGR-GO v1:

- QQQ
- MU
- EWY
- TQQQ
- CASH

It adds a state layer:

- `panic`
- `repair`
- `transition`
- `constructive`
- `euphoric`
- `event_guard`

The state layer is driven by:

- VIX rolling percentile
- VIX falling or rising behavior
- 10-year Treasury yield shock percentile
- 20-day cross-asset correlation
- event density
- QQQ drawdown stress
- trend and leadership scores

## Selected Parameters

```json
{
  "hysteresisDays": 1,
  "panicRiskyCut": 0.15,
  "panicQqqCut": 0.0,
  "euphoriaRiskyCut": 0.12,
  "repairCashDeploy": 0.70,
  "constructiveCashDeploy": 0.90,
  "minCash": 0.0
}
```

Interpretation:

- Panic: lightly reduce MU/EWY risk exposure, clear TQQQ through the base risk
  rules, but do not cut QQQ core further.
- Euphoria: trim 12% of MU/TQQQ exposure into cash.
- Repair: deploy 70% of available cash back into the strongest eligible sleeves.
- Constructive: deploy 90% of available cash when stress is low.
- Event guard: keep MGR-GO v1's event protection structure.

## Strict Rolling Validation

Validation script:

`C:/Users/Administrator/Downloads/us_dynamic_mechanism_rolling_validation.py`

Output directory:

`C:/Users/Administrator/Downloads/us_dynamic_mechanism_rolling_output_core`

Validation method:

1. Generate mechanism candidates around the MGR-GO v1 overlay family.
2. Pre-screen candidates using only data up to 2025.
3. Run full `adaptive_guarded_open` execution simulation on selected candidates.
4. Select static best using 2023-2024 training plus 2025 validation.
5. Test on 2026H1 out of sample.
6. Compare against MGR-GO v1 and monthly fixed bucket baseline.

## Results

| Period | Strategy | End value | Max drawdown | Sharpe |
| --- | --- | ---: | ---: | ---: |
| 2025 validation | MGR-GO v1 | 1.8055 | -26.29% | 2.5518 |
| 2025 validation | DMA-RS v1 candidate | 1.8257 | -25.40% | 2.6328 |
| 2026H1 test | MGR-GO v1 | 2.1854 | -16.36% | 7.6917 |
| 2026H1 test | DMA-RS v1 candidate | 2.2003 | -15.16% | 7.8269 |
| 2024-2026H1 OOS | MGR-GO v1 | 3.7832 | -41.04% | 2.0459 |
| 2024-2026H1 OOS | DMA-RS v1 candidate | 3.8856 | -40.23% | 2.0960 |
| 2023-2026H1 full | MGR-GO v1 | 5.7781 | -41.04% | 2.0808 |
| 2023-2026H1 full | DMA-RS v1 candidate | 5.9706 | -40.23% | 2.1237 |

For reference, the fixed monthly bucket baseline over 2023-2026H1 reached
6.0210 with max drawdown -31.88%. This means DMA-RS v1 improves over MGR-GO v1
in the tested dynamic-family comparison, but it still does not conclusively
dominate every fixed-bucket long-window benchmark.

## Latest Signal In Validation Run

As of 2026-06-29:

| Asset | Target |
| --- | ---: |
| QQQ | 50% |
| MU | 22% |
| EWY | 13% |
| TQQQ | 5% |
| CASH | 10% |

Latest phase: `transition`

## Production Decision

Do not replace MGR-GO v1 automatically yet. DMA-RS v1 is the current best
dynamic mechanism candidate, but it still needs:

- live dashboard integration as an alternate strategy profile
- broker-position-aware order sizing
- minute-level or VWAP-level fill validation
- paper trading before live execution

