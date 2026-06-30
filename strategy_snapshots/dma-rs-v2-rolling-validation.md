# DMA-RS v2 Atmosphere-Fused Rolling Validation

Generated: 2026-06-30T02:01:11.157125+00:00
Latest signal date: 2026-06-29
Best static variant: `v2_offense`

## Method

- Base execution model: adaptive_guarded_open with 5 bps one-way cost.
- Baselines: monthly fixed bucket, MGR-GO v1, DMA-RS v1 candidate, DMA-RS v2 deployed proxy, rolling v2 selectors.
- Selection uses only prior data for rolling selectors: 252-day top1, 504-day top1, 504-day top3 blend.
- Dashboard-only live dimensions are replayed with transparent historical proxies: cross-index correlation, CTA proxy, sector anomaly heat, credit/liquidity proxy, cross-border proxy, and margin-fragility proxy.

## Decision

Do not promote DMA-RS v2 to default execution yet. The rolling validation confirms that v2 behaves as a useful defensive atmosphere layer, but it does not consistently beat MGR-GO v1 or DMA-RS v1 on return.

- 2026YTD deployed-proxy drawdown improves to -14.40%, versus MGR-GO v1 -16.36% and DMA-RS v1 -15.16%.
- 2026YTD deployed-proxy end value is 2.1668, below MGR-GO v1 2.2244 and DMA-RS v1 2.2381.
- 2024-2026YTD deployed-proxy end value is 3.8720, below MGR-GO v1 4.1231 and DMA-RS v1 4.2840.
- Keep v2 as paper_candidate and use it as a risk-control reference, not the live default.

## Key Summary

| name                       | label                  |   end_value | max_dd   |   sharpe0 | avg_cash   |
|:---------------------------|:-----------------------|------------:|:---------|----------:|:-----------|
| baseline_monthly_bucket    | train_2023_2024        |      1.9008 | -22.00%  |    1.5338 | 0.00%      |
| baseline_monthly_bucket    | val_2025               |      1.7517 | -29.74%  |    2.168  | 0.00%      |
| baseline_monthly_bucket    | test_2026ytd           |      1.8801 | -16.81%  |    5.8025 | 0.00%      |
| baseline_monthly_bucket    | oos_2024_2026ytd       |      3.7912 | -31.88%  |    2.0549 | 0.00%      |
| baseline_monthly_bucket    | full_2023_2026ytd      |      6.2602 | -31.88%  |    2.1948 | 0.00%      |
| mgr_go_v1                  | train_2023_2024        |      1.5131 | -23.25%  |    1.0575 | 8.16%      |
| mgr_go_v1                  | val_2025               |      1.7998 | -26.11%  |    2.6082 | 9.22%      |
| mgr_go_v1                  | test_2026ytd           |      2.2244 | -16.36%  |    8.0422 | 8.36%      |
| mgr_go_v1                  | oos_2024_2026ytd       |      4.1231 | -35.59%  |    2.2798 | 8.55%      |
| mgr_go_v1                  | full_2023_2026ytd      |      6.0574 | -35.59%  |    2.2218 | 8.49%      |
| dma_rs_v1_candidate        | train_2023_2024        |      1.5588 | -22.17%  |    1.1133 | 9.05%      |
| dma_rs_v1_candidate        | val_2025               |      1.8279 | -25.00%  |    2.7235 | 9.93%      |
| dma_rs_v1_candidate        | test_2026ytd           |      2.2381 | -15.16%  |    8.1679 | 9.50%      |
| dma_rs_v1_candidate        | oos_2024_2026ytd       |      4.284  | -34.33%  |    2.3603 | 9.56%      |
| dma_rs_v1_candidate        | full_2023_2026ytd      |      6.3771 | -34.33%  |    2.2915 | 9.36%      |
| dma_rs_v2_deployed_proxy   | train_2023_2024        |      1.4921 | -23.19%  |    1.0662 | 13.87%     |
| dma_rs_v2_deployed_proxy   | val_2025               |      1.7375 | -24.88%  |    2.5868 | 14.83%     |
| dma_rs_v2_deployed_proxy   | test_2026ytd           |      2.1668 | -14.40%  |    8.1304 | 14.16%     |
| dma_rs_v2_deployed_proxy   | oos_2024_2026ytd       |      3.872  | -34.37%  |    2.2973 | 14.20%     |
| dma_rs_v2_deployed_proxy   | full_2023_2026ytd      |      5.6176 | -34.37%  |    2.2487 | 14.19%     |
| dma_rs_v2_static_best      | train_2023_2024        |      1.511  | -23.52%  |    1.068  | 12.23%     |
| dma_rs_v2_static_best      | val_2025               |      1.7623 | -24.67%  |    2.628  | 13.25%     |
| dma_rs_v2_static_best      | test_2026ytd           |      2.1858 | -15.27%  |    8.053  | 12.55%     |
| dma_rs_v2_static_best      | oos_2024_2026ytd       |      3.9645 | -34.24%  |    2.2892 | 12.56%     |
| dma_rs_v2_static_best      | full_2023_2026ytd      |      5.8205 | -34.24%  |    2.2445 | 12.57%     |
| dma_rs_v2_rolling_252_top1 | val_2025               |      1.7082 | -24.74%  |    2.4834 | 15.54%     |
| dma_rs_v2_rolling_252_top1 | test_2026ytd           |      2.2104 | -14.98%  |    8.3157 | 13.00%     |
| dma_rs_v2_rolling_252_top1 | oos_2024_2026ytd       |      3.9106 | -34.24%  |    2.294  | 14.52%     |
| dma_rs_v2_rolling_504_top1 | val_2025               |      1.7001 | -24.13%  |    2.4928 | 16.29%     |
| dma_rs_v2_rolling_504_top1 | test_2026ytd           |      2.1959 | -14.98%  |    8.19   | 12.80%     |
| dma_rs_v2_rolling_504_top1 | oos_2024_2026ytd       |      3.8282 | -34.12%  |    2.2522 | 14.40%     |
| dma_rs_v2_rolling_504_top3 | val_2025               |      1.7317 | -24.61%  |    2.5675 | 14.80%     |
| dma_rs_v2_rolling_504_top3 | test_2026ytd           |      2.1965 | -15.05%  |    8.1864 | 12.84%     |
| dma_rs_v2_rolling_504_top3 | oos_2024_2026ytd       |      3.8895 | -34.51%  |    2.2756 | 13.86%     |
| baseline_monthly_bucket    | low_disturbance_months |      0.9584 | -9.77%   |   -0.3895 | 0.00%      |
| mgr_go_v1                  | low_disturbance_months |      0.9522 | -8.82%   |   -0.5333 | 8.21%      |
| dma_rs_v1_candidate        | low_disturbance_months |      0.956  | -8.45%   |   -0.4729 | 9.56%      |
| dma_rs_v2_deployed_proxy   | low_disturbance_months |      0.9623 | -7.99%   |   -0.4298 | 12.08%     |
| dma_rs_v2_static_best      | low_disturbance_months |      0.9659 | -8.01%   |   -0.3787 | 10.53%     |
| dma_rs_v2_rolling_252_top1 | low_disturbance_months |      0.9636 | -7.73%   |   -0.4301 | 13.78%     |
| dma_rs_v2_rolling_504_top1 | low_disturbance_months |      0.9636 | -7.73%   |   -0.4301 | 13.78%     |
| dma_rs_v2_rolling_504_top3 | low_disturbance_months |      0.9624 | -7.91%   |   -0.4308 | 12.34%     |

## Latest DMA-RS v2 Deployed-Proxy Signal

- Phase: `event_guard`
- Risk budget: 51.04%
- Cash floor: 19.27%
- QQQ: 50.00%
- MU: 22.00%
- EWY: 8.73%
- TQQQ: 0.00%
- CASH: 19.27%

## Output Files

- `C:\Users\Administrator\Downloads\us_dma_rs_v2_rolling_output\dma_rs_v2_rolling_summary.csv`
- `C:\Users\Administrator\Downloads\us_dma_rs_v2_rolling_output\dma_rs_v2_monthly_returns.csv`
- `C:\Users\Administrator\Downloads\us_dma_rs_v2_rolling_output\dma_rs_v2_candidate_grid.csv`
- `C:\Users\Administrator\Downloads\us_dma_rs_v2_rolling_output\dma_rs_v2_selector_choices.csv`
- `C:\Users\Administrator\Downloads\us_dma_rs_v2_rolling_output\dma_rs_v2_latest_signal.json`
