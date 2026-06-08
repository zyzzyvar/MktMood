const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseCboeHistory,
  parseFinraMarginRows,
  buildStructureIndicators,
  buildDeleveragingAnalysis,
  buildDeleveragingFramework
} = require("../deleveraging");

test("parses Cboe daily history", () => {
  const rows = parseCboeHistory("DATE,OPEN,HIGH,LOW,CLOSE\n06/04/2026,18,20,17,19.2\n06/05/2026,19,21,18,20.5");
  assert.deepEqual(rows, [
    { date: "2026-06-04", value: 19.2 },
    { date: "2026-06-05", value: 20.5 }
  ]);
});

test("parses FINRA margin rows in chronological order", () => {
  const rows = parseFinraMarginRows("<table><tr><td>Apr-26</td><td>1,304,281</td><td>217,836</td><td>215,445</td></tr><tr><td>Mar-26</td><td>1,220,922</td><td>221,860</td><td>205,600</td></tr></table>");
  assert.equal(rows[0].date, "2026-03");
  assert.equal(rows[1].value, 1304.281);
});

test("builds transparent correlation and CTA proxies", () => {
  const dates = Array.from({ length: 70 }, (_, index) => `2026-03-${String(index + 1).padStart(2, "0")}`);
  const indicator = (id, slope) => ({
    id,
    status: "ok",
    history: dates.map((date, index) => ({ date, value: 100 + index * slope + Math.sin(index / 3) }))
  });
  const derived = buildStructureIndicators([
    indicator("spx", 0.5),
    indicator("nasdaq", 0.7),
    indicator("rut", 0.35)
  ]);
  assert.equal(derived.length, 2);
  assert.equal(derived[0].status, "ok");
  assert.equal(derived[1].status, "ok");
});

test("classifies a mechanical selloff and bottom stage", () => {
  const indicators = [
    sample("nasdaq", { changePct: -4.7, history: priceHistory(100, -1.5) }),
    sample("rut", { changePct: -2.2, history: priceHistory(100, -0.6) }),
    sample("btc", { history: priceHistory(100, -2.2) }),
    sample("vix", { value: 18.5 }),
    sample("cross_asset_correlation", { value: 0.9 }),
    sample("btc_open_interest", { trend20: -9, changePct: -3 }),
    sample("vix_term_spread", { value: -1 }),
    sample("btc_funding", { value: -0.5 }),
    sample("cta_pressure_proxy", { value: -60 }),
    sample("rsp_spy", { changePct: -0.5, trend20: -1 }),
    sample("hyg_lqd", { changePct: -0.1, trend20: -0.2 }),
    sample("tnx", { change: 0.03 }),
    sample("dxy", { changePct: 0.2 }),
    sample("finra_margin_debt", { trend60: 30 })
  ];
  const analysis = buildDeleveragingAnalysis(indicators);
  const framework = buildDeleveragingFramework(analysis);
  assert.equal(analysis.diagnosis.type, "mechanical");
  assert.equal(analysis.bottom.stage, 1);
  assert.equal(framework.kind, "deleveraging");
});

test("does not confirm crypto stabilization after only a one-day rebound", () => {
  const oiHistory = priceHistory(2.5, -0.08);
  oiHistory[oiHistory.length - 1].value += 0.1;
  const indicators = [
    sample("btc_funding", { value: 0.4 }),
    sample("btc_open_interest", { changePct: 1, trend20: -24, history: oiHistory }),
    sample("vix_term_spread", { value: 1 }),
    sample("cta_pressure_proxy", { value: 10 }),
    sample("cross_asset_correlation", { value: 0.5 }),
    sample("rsp_spy", { changePct: 0.2 }),
    sample("finra_margin_debt", { trend60: 10 })
  ];
  const analysis = buildDeleveragingAnalysis(indicators);
  const crypto = analysis.bottom.confirmations.find((item) => item.id === "crypto-normalization");
  assert.equal(crypto.met, false);
});

function sample(id, overrides = {}) {
  return {
    id,
    status: "ok",
    value: 0,
    change: 0,
    changePct: 0,
    trend20: 0,
    history: priceHistory(100, 0.2),
    ...overrides
  };
}

function priceHistory(start, slope) {
  return Array.from({ length: 12 }, (_, index) => ({
    date: `2026-05-${String(index + 1).padStart(2, "0")}`,
    value: start + index * slope
  }));
}
