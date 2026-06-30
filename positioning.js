const YAHOO_BASE_URLS = (process.env.YAHOO_BASE_URLS || "https://query1.finance.yahoo.com,https://query2.finance.yahoo.com")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const TIMEOUT_MS = Number(process.env.POSITIONING_YAHOO_TIMEOUT_MS || 10000);

const SYMBOLS = {
  QQQ: "QQQ",
  MU: "MU",
  EWY: "EWY",
  TQQQ: "TQQQ",
  SPY: "SPY",
  SMH: "SMH",
  XLK: "XLK",
  VIX: "^VIX",
  TNX: "^TNX",
  KOSPI: "^KS11",
  USDKRW: "KRW=X"
};

const BEST_PARAMS = {
  vixGreen: 22,
  vixRed: 24,
  rateJump: 0.25,
  qqqFloor: 0.2,
  redCash: 0.25,
  tqqqCap: 0.18,
  topConcentration: 0.75,
  earningsMuCap: 0.25
};

const DMA_RS_V1_PARAMS = {
  hysteresisDays: 1,
  panicRiskyCut: 0.15,
  panicQqqCut: 0.0,
  euphoriaRiskyCut: 0.12,
  repairCashDeploy: 0.70,
  constructiveCashDeploy: 0.90,
  minCash: 0.0
};

const DMA_RS_V2_PARAMS = {
  minCash: 0.03,
  maxCash: 0.48,
  highRiskCash: 0.34,
  eventCashAdd: 0.08,
  fragilityCashAdd: 0.10,
  riskOnCashCut: 0.08,
  maxTqqq: 0.16,
  guardedTqqq: 0.06,
  maxMu: 0.56,
  maxEwy: 0.32,
  coreQqqMin: 0.36,
  coreQqqMax: 0.70
};

async function buildPositioningStrategy(context = {}) {
  try {
    const series = await fetchAllSeries();
    const feature = buildLatestFeature(series);
    const signal = buildRotationSignal(feature, context);
    return {
      status: "ok",
      strategyName: "Macro-gated strong rotation",
      updatedAt: new Date().toISOString(),
      asOf: feature.asOf,
      ...signal,
      backtest: {
        period: "2026H1",
        baselineReturnPct: 84.01,
        strategyReturnPct: 107.96,
        baselineMaxDrawdownPct: -16.81,
        strategyMaxDrawdownPct: -17.96,
        note: "本地离线回测口径：QQQ 50% / MU 25% / EWY 15% / TQQQ 10% 月度再平衡基准；策略含 5 bps 单边成本。"
      },
      execution: {
        rebalanceThresholdPct: 2,
        cadence: "每日收盘后或美股盘前更新；目标仓位变化超过 2 个百分点再调整。",
        guardrail: "TQQQ 不融资、不隔夜扩大到上限之外；红灯时清零 TQQQ 并提高现金。"
      },
      sources: Object.entries(SYMBOLS).map(([key, symbol]) => ({ key, symbol, source: "Yahoo Finance chart" }))
    };
  } catch (error) {
    return {
      status: "error",
      updatedAt: new Date().toISOString(),
      asOf: null,
      title: "仓位策略暂不可用",
      summary: "无法拉取足够的价格与宏观代理数据，暂不生成自动仓位建议。",
      error: error.message,
      targets: [],
      alerts: []
    };
  }
}

async function fetchAllSeries() {
  const entries = await Promise.all(Object.entries(SYMBOLS).map(async ([key, symbol]) => {
    const result = await fetchYahooChart(symbol);
    return [key, normalizeChart(result)];
  }));
  return Object.fromEntries(entries);
}

async function fetchYahooChart(symbol) {
  const errors = [];
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d&events=history&includeAdjustedClose=true`;
  for (const baseUrl of YAHOO_BASE_URLS) {
    try {
      const response = await fetchWithTimeout(`${baseUrl}${path}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      const result = json.chart?.result?.[0];
      if (!result) throw new Error(json.chart?.error?.description || "Yahoo returned no chart result");
      return result;
    } catch (error) {
      errors.push(`${baseUrl}: ${error.message}`);
    }
  }
  throw new Error(`Yahoo Finance unavailable for ${symbol}: ${errors.join(" | ")}`);
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 market-atmosphere-dashboard/positioning"
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeChart(result) {
  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const adj = result.indicators?.adjclose?.[0]?.adjclose || quote.close || [];
  const len = Math.min(timestamps.length, adj.length);
  const rows = [];
  for (let i = 0; i < len; i += 1) {
    const close = Number(adj[i]);
    const rawClose = Number(quote.close?.[i]);
    if (!Number.isFinite(close)) continue;
    const ratio = Number.isFinite(rawClose) && rawClose !== 0 ? close / rawClose : 1;
    const adjusted = (value) => {
      const n = Number(value);
      return Number.isFinite(n) ? n * ratio : null;
    };
    rows.push({
      date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
      open: adjusted(quote.open?.[i]) ?? close,
      high: adjusted(quote.high?.[i]) ?? close,
      low: adjusted(quote.low?.[i]) ?? close,
      close
    });
  }
  if (rows.length < 220) throw new Error(`${result.meta?.symbol || "symbol"} has insufficient history`);
  return rows;
}

function buildLatestFeature(series) {
  const required = ["QQQ", "MU", "EWY", "TQQQ", "SPY", "SMH", "XLK", "VIX", "TNX"];
  const commonDates = required
    .map((key) => new Set(series[key].map((item) => item.date)))
    .reduce((acc, set) => new Set([...acc].filter((date) => set.has(date))));
  const asOf = [...commonDates].sort().at(-1);
  if (!asOf) throw new Error("No common trading date for positioning inputs");

  const feature = { asOf };
  for (const key of ["QQQ", "MU", "EWY", "TQQQ", "SPY", "SMH", "XLK", "KOSPI"]) {
    feature[key] = metricsFor(series[key], asOf);
  }
  feature.VIX = metricsFor(series.VIX, asOf);
  feature.TNX = metricsFor(series.TNX, asOf);
  feature.USDKRW = metricsFor(series.USDKRW, asOf);
  const ratioDates = buildAlignedRatio(series.SMH, series.SPY, asOf);
  const xlkRatioDates = buildAlignedRatio(series.XLK, series.SPY, asOf);
  feature.smhSpy = {
    value: ratioDates.at(-1).value,
    sma20: average(ratioDates.slice(-20).map((item) => item.value))
  };
  feature.xlkSpy = {
    value: xlkRatioDates.at(-1).value,
    sma20: average(xlkRatioDates.slice(-20).map((item) => item.value))
  };
  feature.dynamic = buildDynamicAtmosphere(series, feature, asOf);
  return feature;
}

function metricsFor(rows, asOf) {
  const eligible = rows.filter((item) => item.date <= asOf);
  if (eligible.length < 220) throw new Error(`Insufficient series history as of ${asOf}`);
  const values = eligible.map((item) => item.close);
  const latest = eligible.at(-1);
  const previous = eligible.at(-2);
  const close = values.at(-1);
  return {
    close,
    open: latest.open,
    high: latest.high,
    low: latest.low,
    prevClose: previous?.close ?? close,
    latestGapPct: previous?.close ? ((latest.open / previous.close) - 1) * 100 : 0,
    ret5: pctChange(values, 5),
    ret10: pctChange(values, 10),
    ret20: pctChange(values, 20),
    sma5: average(values.slice(-5)),
    sma20: average(values.slice(-20)),
    sma50: average(values.slice(-50)),
    sma200: average(values.slice(-200)),
    hi20: Math.max(...values.slice(-20)),
    hi252: Math.max(...values.slice(-252)),
    rsi2: rsi(values, 2),
    rsi14: rsi(values, 14),
    change5: close - values.at(-6)
  };
}

function buildAlignedRatio(numerator, denominator, asOf) {
  const denMap = new Map(denominator.filter((item) => item.date <= asOf).map((item) => [item.date, item.close]));
  return numerator
    .filter((item) => item.date <= asOf && denMap.has(item.date))
    .map((item) => ({ date: item.date, value: item.close / denMap.get(item.date) }))
    .slice(-60);
}

function buildDynamicAtmosphere(series, feature, asOf) {
  const vixValues = series.VIX.filter((item) => item.date <= asOf).map((item) => item.close).slice(-252);
  const tnxRows = series.TNX.filter((item) => item.date <= asOf);
  const tnxShockValues = [];
  for (let i = Math.max(5, tnxRows.length - 252); i < tnxRows.length; i += 1) {
    tnxShockValues.push(Math.abs(tnxRows[i].close - tnxRows[i - 5].close));
  }
  const returns = ["QQQ", "MU", "EWY", "TQQQ"].map((symbol) => {
    const rows = series[symbol].filter((item) => item.date <= asOf).slice(-21);
    const out = [];
    for (let i = 1; i < rows.length; i += 1) out.push(rows[i].close / rows[i - 1].close - 1);
    return out;
  });
  const crossCorr20 = averagePairwiseCorrelation(returns);
  const eventCount = 0;
  const qqqDrawdownStress = Math.abs(Math.min(feature.QQQ.close / feature.QQQ.hi20 - 1, 0));
  const vixPct252 = percentileRank(vixValues, feature.VIX.close);
  const tnxShockPct252 = percentileRank(tnxShockValues, Math.abs(feature.TNX.change5));
  const trendScore = (
    (feature.SPY.close > feature.SPY.sma50 ? 1 : 0)
    + (feature.QQQ.close > feature.QQQ.sma20 ? 1 : 0)
    + (feature.QQQ.close > feature.QQQ.sma50 ? 1 : 0)
    + (feature.QQQ.close > feature.QQQ.sma200 ? 1 : 0)
    + (feature.smhSpy.value > feature.smhSpy.sma20 ? 1 : 0)
    + (feature.xlkSpy.value > feature.xlkSpy.sma20 ? 1 : 0)
  ) / 6;
  const leadershipScore = (
    (feature.smhSpy.value > feature.smhSpy.sma20 ? 1 : 0)
    + (feature.xlkSpy.value > feature.xlkSpy.sma20 ? 1 : 0)
    + (feature.KOSPI.close > feature.KOSPI.sma20 ? 1 : 0)
  ) / 3;
  const stressScore = clamp(
    0.36 * clamp(vixPct252, 0, 1)
      + 0.18 * clamp(tnxShockPct252, 0, 1)
      + 0.16 * clamp(crossCorr20, 0, 1)
      + 0.15 * (Math.min(eventCount, 2) / 2)
      + 0.15 * clamp(qqqDrawdownStress / 0.08, 0, 1),
    0,
    1
  );
  return {
    vixPct252: round(vixPct252, 4),
    tnxShockPct252: round(tnxShockPct252, 4),
    crossCorr20: round(crossCorr20, 4),
    trendScore: round(trendScore, 4),
    leadershipScore: round(leadershipScore, 4),
    qqqDrawdownStress: round(qqqDrawdownStress, 4),
    stressScore: round(stressScore, 4),
    vixFalling: feature.VIX.close <= feature.VIX.sma5 * 1.03
  };
}

function percentileRank(values, current) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length || !Number.isFinite(current)) return 0.5;
  return clean.filter((value) => value <= current).length / clean.length;
}

function averagePairwiseCorrelation(seriesList) {
  const pairs = [];
  for (let i = 0; i < seriesList.length; i += 1) {
    for (let j = i + 1; j < seriesList.length; j += 1) {
      const corr = correlation(seriesList[i], seriesList[j]);
      if (Number.isFinite(corr)) pairs.push(corr);
    }
  }
  return pairs.length ? average(pairs) : 0.25;
}

function correlation(a, b) {
  const len = Math.min(a.length, b.length);
  if (len < 5) return NaN;
  const x = a.slice(-len);
  const y = b.slice(-len);
  const ax = average(x);
  const ay = average(y);
  let numerator = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < len; i += 1) {
    const xv = x[i] - ax;
    const yv = y[i] - ay;
    numerator += xv * yv;
    dx += xv * xv;
    dy += yv * yv;
  }
  const denom = Math.sqrt(dx * dy);
  return denom > 0 ? numerator / denom : NaN;
}

function buildRotationSignal(feature, context) {
  const market = marketState(feature);
  const events = eventRisk(feature.asOf, context.upcomingEvents);
  const atmosphere = buildAtmosphereState(feature, context, market, events);
  const eventRiskOn = events.fomcWindow || events.opexWindow || events.quarterWindow;
  let targets;
  let mode;
  if (market.state === "red") {
    mode = "risk-off";
    targets = redTargets(events);
  } else if (market.state === "yellow" || eventRiskOn) {
    mode = "event-guard";
    targets = guardTargets(events);
  } else {
    mode = "green-rotation";
    targets = greenTargets(feature, events);
  }
  const diagnostics = buildDiagnostics(feature, market, events);
  const targetRows = rowsFromTargets(feature, targets, mode, (symbol) => scoreSymbol(feature, symbol));
  const executionPlan = buildExecutionPlan(feature, mode, market, events, targetRows);
  const strategyProfiles = buildStrategyProfiles(feature, mode, market, events, targets, targetRows, atmosphere);
  const strategyComparison = compareStrategyProfiles(strategyProfiles);
  return {
    mode,
    title: signalTitle(mode, market, events),
    summary: signalSummary(mode, targets, market, events),
    state: {
      marketState: market.state,
      marketScore: market.score,
      vix: round(feature.VIX.close, 2),
      vixSma20: round(feature.VIX.sma20, 2),
      tnxFiveDayChange: round(feature.TNX.change5, 3),
      smhRelativeStrong: feature.smhSpy.value > feature.smhSpy.sma20,
      xlkRelativeStrong: feature.xlkSpy.value > feature.xlkSpy.sma20,
      atmospherePhase: atmosphere.phase,
      atmosphereRiskBudget: atmosphere.riskBudget
    },
    events,
    atmosphere,
    targets: targetRows,
    strategyProfiles,
    strategyComparison,
    executionPlan,
    diagnostics,
    alerts: buildPositioningAlerts(mode, market, events, targets)
  };
}

function marketState(feature) {
  let score = 0;
  score += feature.SPY.close > feature.SPY.sma50 ? 1 : 0;
  score += feature.QQQ.close > feature.QQQ.sma50 ? 1 : 0;
  score += feature.QQQ.close > feature.QQQ.sma200 ? 1 : 0;
  score += feature.VIX.close < BEST_PARAMS.vixGreen && feature.VIX.close <= feature.VIX.sma20 * 1.05 ? 1 : 0;
  score += feature.smhSpy.value > feature.smhSpy.sma20 ? 1 : 0;
  score += feature.TNX.change5 <= BEST_PARAMS.rateJump ? 1 : 0;
  const red = feature.VIX.close >= BEST_PARAMS.vixRed
    || (feature.VIX.close > feature.VIX.sma20 * 1.25 && feature.QQQ.close < feature.QQQ.sma20)
    || (feature.TNX.change5 > BEST_PARAMS.rateJump * 1.6 && feature.QQQ.close < feature.QQQ.sma20);
  if (red) return { state: "red", score };
  if (score >= 5) return { state: "green", score };
  if (score >= 3) return { state: "yellow", score };
  return { state: "red", score };
}

function eventRisk(asOf, upcomingEvents = {}) {
  const date = parseDate(asOf);
  const allEvents = [
    ...(upcomingEvents.highAttention || []),
    ...(upcomingEvents.macro || []),
    ...(upcomingEvents.earnings || [])
  ];
  const near = (event, maxDays) => {
    const days = Number(event.daysUntil);
    if (Number.isFinite(days)) return days >= 0 && days <= maxDays;
    if (!event.date) return false;
    const diff = Math.round((parseDate(event.date) - date) / 86400000);
    return diff >= 0 && diff <= maxDays;
  };
  const textOf = (event) => `${event.title || ""} ${event.name || ""} ${event.symbol || ""} ${event.company || ""}`;
  const fomcWindow = allEvents.some((event) => near(event, 2) && /fomc|fed|federal reserve|powell|rate|利率|美联储|鲍威尔/i.test(textOf(event)));
  const muEarningsWindow = allEvents.some((event) => near(event, 2) && /(^|\W)(mu|micron)(\W|$)|美光/i.test(textOf(event)));
  const opexWindow = Math.abs(businessDayDistance(date, thirdFriday(date.getUTCFullYear(), date.getUTCMonth()))) <= 1;
  const qEnd = quarterEnd(date);
  const quarterWindow = businessDayDistance(date, qEnd) >= -1 && businessDayDistance(date, qEnd) <= 2;
  return { fomcWindow, muEarningsWindow, opexWindow, quarterWindow };
}

function redTargets(events) {
  const weights = {
    QQQ: Math.max(0.2, BEST_PARAMS.qqqFloor * 0.9),
    MU: events.muEarningsWindow ? 0.04 : 0.08,
    EWY: 0.04,
    TQQQ: 0,
    CASH: BEST_PARAMS.redCash
  };
  const scale = (1 - weights.CASH) / (weights.QQQ + weights.MU + weights.EWY + weights.TQQQ);
  for (const key of ["QQQ", "MU", "EWY", "TQQQ"]) weights[key] *= scale;
  return normalize(weights);
}

function guardTargets(events) {
  const weights = { QQQ: 0.5, MU: 0.22, EWY: 0.13, TQQQ: 0.05, CASH: 0.1 };
  if (events.muEarningsWindow && weights.MU > BEST_PARAMS.earningsMuCap) {
    weights.CASH += weights.MU - BEST_PARAMS.earningsMuCap;
    weights.MU = BEST_PARAMS.earningsMuCap;
  }
  return normalize(weights);
}

function greenTargets(feature, events) {
  const weights = { QQQ: BEST_PARAMS.qqqFloor, MU: 0, EWY: 0, TQQQ: 0, CASH: 0 };
  const ranked = ["MU", "EWY", "TQQQ", "QQQ"]
    .map((symbol) => ({ symbol, score: scoreSymbol(feature, symbol) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return { QQQ: 0.75, MU: 0, EWY: 0, TQQQ: 0, CASH: 0.25 };
  const top = ranked[0].symbol;
  const second = ranked[1]?.symbol || "QQQ";
  const remainder = 1 - BEST_PARAMS.qqqFloor;
  const topWeight = Math.min(remainder * BEST_PARAMS.topConcentration, remainder);
  weights[top] += topWeight;
  weights[second] += remainder - topWeight;
  const caps = {
    QQQ: 0.7,
    MU: events.muEarningsWindow ? Math.min(0.58, BEST_PARAMS.earningsMuCap) : 0.58,
    EWY: 0.35,
    TQQQ: BEST_PARAMS.tqqqCap
  };
  return normalize(capAndRedistribute(weights, caps));
}

function scoreSymbol(feature, symbol) {
  if (symbol === "CASH") return null;
  if (symbol === "TQQQ") {
    if (!industryOk(feature, "TQQQ")) return -999;
    return 2.2 * feature.QQQ.ret20 + 0.8 * feature.QQQ.ret10 - 0.04 * Math.max(feature.VIX.close - 18, 0);
  }
  if (!industryOk(feature, symbol)) return -999;
  const item = feature[symbol];
  return 1.3 * item.ret20 + 0.7 * item.ret10 + 0.4 * item.ret5;
}

function industryOk(feature, symbol) {
  if (symbol === "MU") return feature.SMH.close > feature.SMH.sma20 && feature.smhSpy.value > feature.smhSpy.sma20;
  if (symbol === "QQQ" || symbol === "TQQQ") return feature.XLK.close > feature.XLK.sma20 && feature.xlkSpy.value > feature.xlkSpy.sma20;
  if (symbol === "EWY") return feature.KOSPI.close > feature.KOSPI.sma20 && feature.USDKRW.ret10 < 0.035;
  return true;
}

function capAndRedistribute(weights, caps) {
  const out = { ...weights };
  for (let i = 0; i < 5; i += 1) {
    let excess = 0;
    const room = {};
    for (const [key, value] of Object.entries(out)) {
      if (key === "CASH") continue;
      const cap = caps[key] ?? 1;
      if (value > cap) {
        excess += value - cap;
        out[key] = cap;
      } else {
        room[key] = Math.max(cap - value, 0);
      }
    }
    const totalRoom = Object.values(room).reduce((sum, value) => sum + value, 0);
    if (excess <= 1e-9 || totalRoom <= 1e-9) break;
    for (const [key, value] of Object.entries(room)) out[key] += excess * value / totalRoom;
  }
  return out;
}

function normalize(weights) {
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) return { QQQ: 0, MU: 0, EWY: 0, TQQQ: 0, CASH: 1 };
  const out = {};
  for (const [key, value] of Object.entries(weights)) out[key] = round(value / total, 4);
  return out;
}

function rowsFromTargets(feature, targets, mode, scoreFn) {
  return Object.entries(targets).map(([symbol, weight]) => ({
    symbol,
    name: targetName(symbol),
    weight,
    weightPct: round(weight * 100, 1),
    price: symbol === "CASH" ? null : round(feature[symbol].close, 2),
    role: targetRole(symbol, mode),
    score: symbol === "CASH" ? null : round(scoreFn(symbol), 4),
    action: actionText(symbol, weight, mode)
  }));
}

function buildAtmosphereState(feature, context = {}, market, events) {
  const indicators = Array.isArray(context.indicators) ? context.indicators : [];
  const byId = new Map(indicators.map((item) => [item.id, item]));
  const score = (id, fallback = 0) => toNumber(byId.get(id)?.score, fallback);
  const value = (id, fallback = 0) => toNumber(byId.get(id)?.value, fallback);
  const trend20 = (id, fallback = 0) => toNumber(byId.get(id)?.trend20, fallback);
  const trend60 = (id, fallback = 0) => toNumber(byId.get(id)?.trend60, fallback);
  const okIndicators = indicators.filter((item) => item.status === "ok" && Number.isFinite(Number(item.score)));
  const pressureScore = averageOr(
    okIndicators.filter((item) => Number(item.score) < 0).slice(0, 8).map((item) => Math.abs(Number(item.score))),
    0
  );
  const supportScore = averageOr(
    okIndicators.filter((item) => Number(item.score) > 0).slice(0, 8).map((item) => Number(item.score)),
    0
  );

  const marketScore = clamp(toNumber(context.marketScore, (market.score - 3) / 3), -1, 1);
  const riskRegimeScore = clamp(toNumber(context.riskRegime?.score, feature.dynamic.stressScore * 100) / 100, 0, 1);
  const correlationRisk = clamp((value("cross_asset_correlation", feature.dynamic.crossCorr20) - 0.50) / 0.38, 0, 1);
  const ctaValue = value("cta_pressure_proxy", 0);
  const ctaRisk = clamp((-ctaValue - 10) / 70, 0, 1);
  const ctaRelief = clamp((ctaValue + 25) / 75, 0, 1);
  const creditStress = clamp(
    Math.max(
      -score("hyg_lqd", 0),
      -trend20("hyg_lqd", 0) / 2,
      score("dxy", 0) < 0 && trend20("dxy", 0) > 1.5 ? 0.4 : 0
    ),
    0,
    1
  );
  const liquidityScore = clamp((score("fed_balance", 0) + score("btc_funding", 0) + score("vix_term_spread", 0)) / 3, -1, 1);
  const breadthScore = clamp((score("rsp_spy", 0) + score("iwm_spy", 0) + score("rut", 0)) / 3, -1, 1);
  const techLeadership = clamp(
    (
      (feature.smhSpy.value > feature.smhSpy.sma20 ? 0.45 : -0.25)
      + (feature.xlkSpy.value > feature.xlkSpy.sma20 ? 0.35 : -0.20)
      + score("nasdaq", 0)
    ) / 1.8,
    -1,
    1
  );
  const crossBorderPressure = clamp(
    Math.max(
      -averageOr([score("kweb", 0), score("hsi", 0), score("cnh", 0)], 0),
      feature.USDKRW.ret10 > 0.035 ? 0.55 : 0,
      trend60("kweb", 0) < -10 ? 0.45 : 0
    ),
    0,
    1
  );

  const anomalyStats = buildAnomalyStats(context.anomalyRadar);
  const eventPressure = buildEventPressure(events, context.upcomingEvents);
  const structure = buildStructurePressure(context.marketStructure);
  const databasePressure = buildDatabasePressure(context.databaseInsights);
  const fragility = clamp(Math.max(toNumber(structure.fragility, 0), trend60("finra_margin_debt", 0) >= 30 ? 0.8 : 0), 0, 1);
  const riskPressure = clamp(
    0.30 * riskRegimeScore
      + 0.16 * structure.risk
      + 0.13 * fragility
      + 0.12 * correlationRisk
      + 0.10 * eventPressure
      + 0.08 * creditStress
      + 0.07 * anomalyStats.heat
      + 0.04 * databasePressure,
    0,
    1
  );
  const repairCredit = clamp(
    0.30 * structure.bottomSupport
      + 0.22 * Math.max(breadthScore, 0)
      + 0.18 * Math.max(liquidityScore, 0)
      + 0.15 * ctaRelief
      + 0.15 * Math.max(techLeadership, 0),
    0,
    1
  );
  const riskBudget = clamp(0.52 + 0.24 * marketScore + 0.22 * repairCredit - 0.44 * riskPressure, 0.18, 0.94);
  const phase = atmospherePhase({
    market,
    events,
    riskRegime: context.riskRegime,
    riskPressure,
    riskBudget,
    repairCredit,
    eventPressure,
    anomalyHeat: anomalyStats.heat,
    techLeadership,
    structure
  });

  const state = {
    phase,
    riskBudget: round(riskBudget, 4),
    cashFloor: round(atmosphereCashFloor({
      riskPressure,
      repairCredit,
      eventPressure,
      fragility,
      marketScore,
      riskBudget,
      riskRegimeScore,
      phase
    }), 4),
    riskPressure: round(riskPressure, 4),
    repairCredit: round(repairCredit, 4),
    marketScore: round(marketScore, 4),
    riskRegimeScore: round(riskRegimeScore, 4),
    pressureScore: round(pressureScore, 4),
    supportScore: round(supportScore, 4),
    breadthScore: round(breadthScore, 4),
    liquidityScore: round(liquidityScore, 4),
    techLeadership: round(techLeadership, 4),
    crossBorderPressure: round(crossBorderPressure, 4),
    correlationRisk: round(correlationRisk, 4),
    ctaRisk: round(ctaRisk, 4),
    eventPressure: round(eventPressure, 4),
    anomalyHeat: round(anomalyStats.heat, 4),
    semiconductorHeat: round(anomalyStats.semiconductorHeat, 4),
    fragility: round(fragility, 4),
    structureRisk: round(structure.risk, 4),
    databasePressure: round(databasePressure, 4),
    sourceCoverage: {
      indicators: indicators.length,
      okIndicators: okIndicators.length,
      highAnomalies: anomalyStats.highCount,
      sectorMoves: anomalyStats.sectorCount,
      structureType: context.marketStructure?.diagnosis?.type || "unknown",
      riskRegime: context.riskRegime?.name || "unknown"
    }
  };
  state.drivers = buildAtmosphereDrivers(state, context, byId, anomalyStats, structure);
  state.notes = [
    "v2 consumes dashboard atmosphere, not only symbol price history.",
    "paper_candidate until rolling validation promotes it."
  ];
  return state;
}

function atmospherePhase(input) {
  const eventGuard = input.events.fomcWindow || input.events.opexWindow || input.events.quarterWindow || input.events.muEarningsWindow;
  if (
    input.riskRegime?.level === "danger"
    || input.structure.vetoCount > 0
    || (input.market.state === "red" && input.riskPressure >= 0.55)
    || input.riskPressure >= 0.72
  ) return "capital_defense";
  if (eventGuard || input.eventPressure >= 0.46) return "event_guard";
  if (input.structure.bottomStage >= 3 && input.repairCredit >= 0.42 && input.riskPressure >= 0.30) return "fragile_repair";
  if (input.anomalyHeat >= 0.58 && input.techLeadership >= 0.25 && input.riskPressure <= 0.58) return "selective_momentum";
  if (input.riskBudget >= 0.68 && input.repairCredit >= 0.45) return "risk_on";
  if (input.riskBudget <= 0.38 || input.riskPressure >= 0.60) return "risk_reduction";
  return "balanced_selective";
}

function atmosphereCashFloor(input) {
  let cash = DMA_RS_V2_PARAMS.minCash
    + 0.28 * input.riskPressure
    + 0.07 * input.eventPressure
    + 0.06 * input.fragility
    - 0.08 * input.repairCredit
    - 0.04 * Math.max(input.marketScore, 0)
    - 0.04 * Math.max(input.riskBudget - 0.55, 0);
  if (input.phase === "capital_defense") cash = Math.max(cash, DMA_RS_V2_PARAMS.highRiskCash);
  if (input.phase === "event_guard") cash = Math.max(cash, 0.14);
  if (input.phase === "risk_reduction") cash = Math.max(cash, 0.22);
  if (input.phase === "fragile_repair") cash = clamp(cash, 0.08, 0.26);
  if (input.phase === "selective_momentum") cash = clamp(cash - DMA_RS_V2_PARAMS.riskOnCashCut / 2, 0.05, 0.20);
  if (input.phase === "risk_on") cash = clamp(cash - DMA_RS_V2_PARAMS.riskOnCashCut, 0.03, 0.14);
  return clamp(cash, DMA_RS_V2_PARAMS.minCash, DMA_RS_V2_PARAMS.maxCash);
}

function buildAnomalyStats(anomalyRadar = {}) {
  const equities = (anomalyRadar.equityAnomalies || []).filter((item) => item.status === "ok");
  const sectors = (anomalyRadar.sectorMoves || []).filter((item) => item.status === "ok");
  const high = equities.filter((item) => item.severity === "high");
  const highUp = high.filter((item) => item.direction === "up").length;
  const highDown = high.filter((item) => item.direction === "down").length;
  const semiEquities = high.filter((item) => /semi|半导体|electronic components/i.test(`${item.sectorLabel || ""} ${item.industryLabel || ""} ${item.classification || ""}`));
  const semiSector = sectors.find((item) => item.symbol === "SMH");
  const techSectors = sectors.filter((item) => /SMH|XLK|XLC|XLY/.test(item.symbol || "") && item.direction === "up");
  const heat = clamp((high.length / 24) + (sectors.length / 10) + Math.max(highUp - highDown, 0) / 36, 0, 1);
  const semiconductorHeat = clamp((semiEquities.length / 8) + (semiSector?.direction === "up" ? 0.25 : 0) + (techSectors.length / 12), 0, 1);
  return {
    heat,
    semiconductorHeat,
    highCount: high.length,
    highUp,
    highDown,
    sectorCount: sectors.length
  };
}

function buildEventPressure(events, upcomingEvents = {}) {
  const allEvents = [
    ...(upcomingEvents.highAttention || []),
    ...(upcomingEvents.macro || []),
    ...(upcomingEvents.earnings || [])
  ];
  const nearCount = allEvents.filter((event) => {
    const days = Number(event.daysUntil);
    return Number.isFinite(days) && days >= 0 && days <= 3;
  }).length;
  let score = Math.min(nearCount, 4) * 0.08;
  if (events.fomcWindow) score += 0.32;
  if (events.opexWindow) score += 0.18;
  if (events.quarterWindow) score += 0.22;
  if (events.muEarningsWindow) score += 0.24;
  return clamp(score, 0, 1);
}

function buildStructurePressure(marketStructure = {}) {
  const diagnosis = marketStructure.diagnosis || {};
  const bottom = marketStructure.bottom || {};
  const fragility = marketStructure.fragility || {};
  const vetoCount = Array.isArray(bottom.vetoes) ? bottom.vetoes.length : 0;
  const bottomStage = toNumber(bottom.stage, 0);
  const fragilityScore = toNumber(
    fragility.score,
    fragility.level === "high" ? 0.85 : fragility.level === "medium" ? 0.52 : fragility.level === "low" ? 0.20 : 0
  );
  let risk = 0;
  if (diagnosis.type === "mechanical") risk += 0.34;
  else if (diagnosis.type === "mixed") risk += 0.24;
  else if (diagnosis.type === "fundamental") risk += 0.30;
  if (bottom.blocked) risk += 0.30;
  if (vetoCount) risk += Math.min(vetoCount, 3) * 0.16;
  if (fragility.level === "high") risk += 0.22;
  else if (fragility.level === "medium") risk += 0.12;
  const bottomSupport = !bottom.blocked && bottomStage >= 3 ? Math.min(1, bottomStage / 4) : 0;
  return {
    risk: clamp(risk, 0, 1),
    bottomSupport,
    bottomStage,
    vetoCount,
    fragility: clamp(fragilityScore, 0, 1),
    label: diagnosis.label || "unknown"
  };
}

function buildDatabasePressure(databaseInsights = {}) {
  const signals = databaseInsights.indicatorSignals || [];
  const high = signals.filter((item) => item.severity === "high" || item.type === "breakout").length;
  const revisions = databaseInsights.eventRevisions || [];
  return clamp(high * 0.12 + Math.min(revisions.length, 5) * 0.03, 0, 1);
}

function buildAtmosphereDrivers(state, context, byId, anomalyStats, structure) {
  const indicatorName = (id) => byId.get(id)?.name || id;
  const topPressures = [...byId.values()]
    .filter((item) => item.status === "ok" && Number(item.score) < 0)
    .sort((a, b) => Number(a.score) - Number(b.score))
    .slice(0, 3)
    .map((item) => `${item.name}: ${round(item.score, 2)}`);
  const topSupports = [...byId.values()]
    .filter((item) => item.status === "ok" && Number(item.score) > 0)
    .sort((a, b) => Number(b.score) - Number(a.score))
    .slice(0, 3)
    .map((item) => `${item.name}: +${round(item.score, 2)}`);
  return [
    `riskRegime ${context.riskRegime?.name || "unknown"} / ${round(state.riskRegimeScore * 100, 0)}`,
    `marketScore ${round(state.marketScore, 2)}; riskBudget ${round(state.riskBudget * 100, 1)}%`,
    `structure ${structure.label}; bottomStage ${structure.bottomStage}`,
    `anomaly high ${anomalyStats.highCount}, sector moves ${anomalyStats.sectorCount}`,
    `pressure ${topPressures.join(" | ") || "none"}`,
    `support ${topSupports.join(" | ") || "none"}`,
    `breadth ${round(state.breadthScore, 2)}, liquidity ${round(state.liquidityScore, 2)}, ${indicatorName("cross_asset_correlation")} risk ${round(state.correlationRisk, 2)}`
  ];
}

function buildStrategyProfiles(feature, mode, market, events, mgrTargets, mgrRows, atmosphere) {
  const phase = dynamicPhase(feature, market, events);
  const dmaTargets = applyDmaOverlay(feature, mgrTargets, phase);
  const dmaRows = rowsFromTargets(feature, dmaTargets, mode, (symbol) => dynamicSymbolScore(feature, symbol));
  const atmosphereTargets = applyAtmosphereOverlay(feature, mgrTargets, atmosphere, events);
  const atmosphereRows = rowsFromTargets(feature, atmosphereTargets, mode, (symbol) => atmosphereSymbolScore(feature, symbol, atmosphere));
  return [
    {
      id: "mgr-go-v1",
      name: "MGR-GO v1",
      status: "deployed_default",
      title: "默认执行策略",
      summary: "线上默认：宏观闸门轮动 + 受保护开盘执行。",
      mode,
      phase: mode,
      backtest: {
        validation: "2026H1 execution sensitivity",
        returnPct: 118.59,
        maxDrawdownPct: -16.36
      },
      targets: mgrRows
    },
    {
      id: "dma-rs-v1-candidate",
      name: "DMA-RS v1 Candidate",
      status: "paper_candidate",
      title: "研究候选策略",
      summary: dmaSummary(phase, dmaTargets),
      mode,
      phase,
      diagnostics: {
        stressScore: feature.dynamic.stressScore,
        trendScore: feature.dynamic.trendScore,
        leadershipScore: feature.dynamic.leadershipScore,
        vixPct252: feature.dynamic.vixPct252,
        tnxShockPct252: feature.dynamic.tnxShockPct252,
        crossCorr20: feature.dynamic.crossCorr20
      },
      backtest: {
        validation: "2023-2024 train / 2025 validation / 2026H1 test",
        returnPct2026H1: 120.03,
        maxDrawdownPct2026H1: -15.16,
        oosReturnRatio2024To2026H1: 3.8856,
        status: "research candidate, not default execution"
      },
      targets: dmaRows
    },
    {
      id: "dma-rs-v2-atmosphere",
      name: "DMA-RS v2 Atmosphere-Fused",
      status: "paper_candidate",
      title: "氛围融合候选策略",
      summary: atmosphereSummary(atmosphere, atmosphereTargets),
      mode,
      phase: atmosphere.phase,
      diagnostics: {
        riskBudget: atmosphere.riskBudget,
        cashFloor: atmosphere.cashFloor,
        riskPressure: atmosphere.riskPressure,
        repairCredit: atmosphere.repairCredit,
        riskRegimeScore: atmosphere.riskRegimeScore,
        marketScore: atmosphere.marketScore,
        eventPressure: atmosphere.eventPressure,
        anomalyHeat: atmosphere.anomalyHeat,
        structureRisk: atmosphere.structureRisk,
        fragility: atmosphere.fragility
      },
      drivers: atmosphere.drivers,
      sleeves: buildAtmosphereSleeves(atmosphereTargets),
      backtest: {
        validation: "live paper profile; rolling validation required before default execution",
        status: "uses MktMood atmosphere dimensions beyond price-only signal"
      },
      targets: atmosphereRows
    }
  ];
}

function dynamicPhase(feature, market, events) {
  const d = feature.dynamic;
  const eventGuard = events.fomcWindow || events.opexWindow || events.quarterWindow || events.muEarningsWindow;
  const panic = market.state === "red"
    || (d.stressScore >= 0.76 && feature.QQQ.close < feature.QQQ.sma20)
    || (d.vixPct252 >= 0.88 && feature.QQQ.ret5 < 0);
  const repair = !panic
    && d.stressScore >= 0.48
    && d.vixFalling
    && feature.QQQ.ret5 > 0
    && feature.QQQ.close >= feature.QQQ.sma20 * 0.985;
  const constructive = !panic
    && d.trendScore >= 0.72
    && d.leadershipScore >= 0.66
    && d.stressScore <= 0.58;
  const euphoric = constructive
    && d.vixPct252 <= 0.38
    && (feature.QQQ.rsi14 >= 68 || feature.QQQ.ret20 >= 0.10);
  if (panic) return "panic";
  if (eventGuard) return "event_guard";
  if (euphoric) return "euphoric";
  if (constructive) return "constructive";
  if (repair) return "repair";
  return "transition";
}

function applyDmaOverlay(feature, mgrTargets, phase) {
  const out = { ...mgrTargets };
  if (phase === "panic") {
    const riskCut = DMA_RS_V1_PARAMS.panicRiskyCut * Math.min(1, Math.max(0.35, feature.dynamic.stressScore / 0.80));
    for (const symbol of ["MU", "EWY"]) {
      const reduction = out[symbol] * riskCut;
      out[symbol] -= reduction;
      out.CASH += reduction;
    }
    out.CASH += out.TQQQ;
    out.TQQQ = 0;
    const qqqReduction = out.QQQ * DMA_RS_V1_PARAMS.panicQqqCut;
    out.QQQ -= qqqReduction;
    out.CASH += qqqReduction;
  } else if (phase === "euphoric") {
    for (const symbol of ["MU", "TQQQ"]) {
      const reduction = out[symbol] * DMA_RS_V1_PARAMS.euphoriaRiskyCut;
      out[symbol] -= reduction;
      out.CASH += reduction;
    }
  } else if (phase === "repair" && feature.dynamic.vixFalling && feature.QQQ.ret5 > 0) {
    deployCash(feature, out, Math.max(0, out.CASH - DMA_RS_V1_PARAMS.minCash) * DMA_RS_V1_PARAMS.repairCashDeploy);
  } else if (phase === "constructive" && feature.dynamic.stressScore < 0.45) {
    deployCash(feature, out, Math.max(0, out.CASH - DMA_RS_V1_PARAMS.minCash) * DMA_RS_V1_PARAMS.constructiveCashDeploy);
  }
  return normalize(out);
}

function applyAtmosphereOverlay(feature, mgrTargets, atmosphere, events) {
  const out = { ...mgrTargets };
  const cashFloor = atmosphere.cashFloor;
  raiseCashTo(out, cashFloor, atmosphere);
  const caps = atmosphereCaps(atmosphere, events);
  capToCash(out, caps);

  const deployable = Math.max(0, out.CASH - cashFloor);
  const deployPct = atmosphereDeployPct(atmosphere);
  if (deployable > 0.005 && deployPct > 0) {
    deployAtmosphereCash(feature, out, deployable * deployPct, atmosphere, caps);
  }

  raiseCashTo(out, cashFloor, atmosphere);
  capToCash(out, caps);
  return normalize(out);
}

function atmosphereCaps(atmosphere, events) {
  let tqqqCap = Math.min(
    DMA_RS_V2_PARAMS.maxTqqq,
    Math.max(0, 0.02 + 0.18 * atmosphere.riskBudget - 0.12 * atmosphere.riskPressure)
  );
  if (atmosphere.phase === "event_guard") tqqqCap = Math.min(tqqqCap, DMA_RS_V2_PARAMS.guardedTqqq);
  if (atmosphere.phase === "capital_defense" || atmosphere.phase === "risk_reduction") tqqqCap = Math.min(tqqqCap, 0.025);
  if (events.muEarningsWindow) tqqqCap = Math.min(tqqqCap, 0.05);
  if (atmosphere.semiconductorHeat > 0.65 && atmosphere.riskPressure < 0.52) tqqqCap = Math.min(DMA_RS_V2_PARAMS.maxTqqq, tqqqCap + 0.02);

  let muCap = DMA_RS_V2_PARAMS.maxMu
    - 0.14 * atmosphere.fragility
    - 0.10 * atmosphere.eventPressure
    + 0.08 * atmosphere.semiconductorHeat
    + 0.04 * Math.max(atmosphere.techLeadership, 0);
  if (events.muEarningsWindow) muCap = Math.min(muCap, BEST_PARAMS.earningsMuCap);
  if (atmosphere.phase === "capital_defense") muCap = Math.min(muCap, 0.18);
  if (atmosphere.phase === "risk_reduction") muCap = Math.min(muCap, 0.24);

  let ewyCap = DMA_RS_V2_PARAMS.maxEwy
    - 0.13 * atmosphere.crossBorderPressure
    - 0.08 * atmosphere.riskPressure
    + 0.05 * Math.max(atmosphere.breadthScore, 0);
  if (atmosphere.phase === "capital_defense") ewyCap = Math.min(ewyCap, 0.10);
  if (atmosphere.phase === "risk_reduction") ewyCap = Math.min(ewyCap, 0.16);

  let qqqCap = DMA_RS_V2_PARAMS.coreQqqMax;
  if (atmosphere.phase === "capital_defense") qqqCap = 0.58;
  if (atmosphere.phase === "risk_on") qqqCap = 0.72;

  return {
    QQQ: clamp(qqqCap, DMA_RS_V2_PARAMS.coreQqqMin, 0.74),
    MU: clamp(muCap, 0.08, DMA_RS_V2_PARAMS.maxMu),
    EWY: clamp(ewyCap, 0.05, DMA_RS_V2_PARAMS.maxEwy),
    TQQQ: clamp(tqqqCap, 0, DMA_RS_V2_PARAMS.maxTqqq)
  };
}

function raiseCashTo(weights, targetCash, atmosphere) {
  let need = targetCash - weights.CASH;
  if (need <= 1e-9) return;
  const order = atmosphere.phase === "capital_defense" || atmosphere.phase === "risk_reduction"
    ? ["TQQQ", "MU", "EWY", "QQQ"]
    : ["TQQQ", "EWY", "MU", "QQQ"];
  for (const symbol of order) {
    if (need <= 1e-9) break;
    const minWeight = symbol === "QQQ" ? Math.min(DMA_RS_V2_PARAMS.coreQqqMin, weights.QQQ) : 0;
    const room = Math.max(0, weights[symbol] - minWeight);
    const cut = Math.min(room, need);
    weights[symbol] -= cut;
    weights.CASH += cut;
    need -= cut;
  }
}

function capToCash(weights, caps) {
  for (const [symbol, cap] of Object.entries(caps)) {
    if (weights[symbol] > cap) {
      const excess = weights[symbol] - cap;
      weights[symbol] = cap;
      weights.CASH += excess;
    }
  }
}

function atmosphereDeployPct(atmosphere) {
  if (atmosphere.phase === "capital_defense" || atmosphere.phase === "event_guard") return 0;
  if (atmosphere.phase === "fragile_repair") return 0.35;
  if (atmosphere.phase === "selective_momentum") return 0.50;
  if (atmosphere.phase === "risk_on") return 0.85;
  if (atmosphere.phase === "balanced_selective") return atmosphere.riskBudget >= 0.55 ? 0.25 : 0;
  return 0;
}

function deployAtmosphereCash(feature, weights, amount, atmosphere, caps) {
  let remaining = Math.min(amount, weights.CASH);
  const ranked = ["QQQ", "MU", "EWY", "TQQQ"]
    .map((symbol) => ({ symbol, score: atmosphereSymbolScore(feature, symbol, atmosphere) }))
    .sort((a, b) => b.score - a.score);
  for (const item of ranked) {
    if (remaining <= 1e-9) break;
    const cap = caps[item.symbol] ?? 1;
    const room = Math.max(0, cap - weights[item.symbol]);
    const add = Math.min(room, remaining);
    weights[item.symbol] += add;
    weights.CASH -= add;
    remaining -= add;
  }
}

function atmosphereSymbolScore(feature, symbol, atmosphere) {
  if (symbol === "CASH") return 0;
  const base = dynamicSymbolScore(feature, symbol);
  if (symbol === "QQQ") {
    return base
      + 0.65 * atmosphere.techLeadership
      + 0.35 * Math.max(atmosphere.breadthScore, 0)
      - 0.35 * atmosphere.riskPressure;
  }
  if (symbol === "MU") {
    return base
      + 1.05 * atmosphere.semiconductorHeat
      + 0.45 * atmosphere.techLeadership
      - 0.55 * atmosphere.fragility
      - 0.35 * atmosphere.eventPressure;
  }
  if (symbol === "EWY") {
    return base
      + 0.35 * Math.max(atmosphere.breadthScore, 0)
      - 0.90 * atmosphere.crossBorderPressure
      - 0.35 * atmosphere.riskPressure;
  }
  if (symbol === "TQQQ") {
    return base
      + 1.05 * atmosphere.riskBudget
      + 0.55 * atmosphere.techLeadership
      - 1.25 * atmosphere.riskPressure
      - 0.65 * atmosphere.eventPressure;
  }
  return base;
}

function buildAtmosphereSleeves(targets) {
  return {
    coreHoldPct: round((targets.QQQ + 0.50 * targets.MU + 0.45 * targets.EWY) * 100, 1),
    swingPct: round((targets.TQQQ + 0.35 * targets.MU + 0.25 * targets.EWY) * 100, 1),
    reserveCashPct: round(targets.CASH * 100, 1)
  };
}

function deployCash(feature, weights, amount) {
  const caps = { QQQ: 0.72, MU: 0.58, EWY: 0.35, TQQQ: 0.18 };
  let remaining = Math.min(amount, weights.CASH);
  const ranked = ["QQQ", "MU", "EWY", "TQQQ"]
    .map((symbol) => ({ symbol, score: dynamicSymbolScore(feature, symbol) }))
    .sort((a, b) => b.score - a.score);
  for (const item of ranked) {
    if (remaining <= 1e-9) break;
    const room = Math.max(0, caps[item.symbol] - weights[item.symbol]);
    const add = Math.min(room, remaining);
    weights[item.symbol] += add;
    weights.CASH -= add;
    remaining -= add;
  }
}

function dynamicSymbolScore(feature, symbol) {
  if (symbol === "CASH") return 0;
  const source = symbol === "TQQQ" ? "QQQ" : symbol;
  if (symbol !== "QQQ" && !industryOk(feature, symbol)) return -8;
  let trendBonus = feature[source].close > feature[source].sma20 ? 0.6 : -0.4;
  if (symbol === "QQQ" && !industryOk(feature, "QQQ")) trendBonus -= 0.35;
  const pullbackBonus = feature[source].rsi2 <= 20 && feature[source].close >= feature[source].sma50 * 0.97 ? 0.25 : 0;
  const overheatPenalty = feature[source].rsi14 >= 76 && feature[source].ret20 >= 0.12 ? 0.35 : 0;
  const leverPenalty = symbol === "TQQQ" ? Math.max(feature.dynamic.vixPct252 - 0.55, 0) * 1.2 : 0;
  return (
    5.0 * feature[source].ret20
    + 2.2 * feature[source].ret10
    + 1.0 * feature[source].ret5
    + trendBonus
    + pullbackBonus
    - overheatPenalty
    - 0.55 * feature.dynamic.stressScore
    - leverPenalty
  );
}

function dmaSummary(phase, targets) {
  const cash = round((targets.CASH || 0) * 100, 1);
  if (phase === "panic") return `DMA-RS v1 进入 panic 覆盖层，轻降风险资产，现金 ${cash}%。`;
  if (phase === "euphoric") return `DMA-RS v1 识别过热，削减部分 MU/TQQQ，现金 ${cash}%。`;
  if (phase === "repair") return `DMA-RS v1 识别修复期，按强弱部署部分现金，现金 ${cash}%。`;
  if (phase === "constructive") return `DMA-RS v1 识别建设性行情，更积极部署现金，现金 ${cash}%。`;
  if (phase === "event_guard") return `DMA-RS v1 维持事件保护结构，现金 ${cash}%。`;
  return `DMA-RS v1 处于 transition，保持默认保护配置，现金 ${cash}%。`;
}

function atmosphereSummary(atmosphere, targets) {
  const cash = round((targets.CASH || 0) * 100, 1);
  const riskBudget = round(atmosphere.riskBudget * 100, 1);
  const cashFloor = round(atmosphere.cashFloor * 100, 1);
  const phaseText = {
    capital_defense: "资本防守",
    event_guard: "事件保护",
    fragile_repair: "脆弱修复",
    selective_momentum: "选择性动量",
    risk_on: "风险进攻",
    risk_reduction: "降风险",
    balanced_selective: "均衡精选"
  }[atmosphere.phase] || atmosphere.phase;
  return `DMA-RS v2 处于${phaseText}；风险预算 ${riskBudget}%，现金底线 ${cashFloor}%，当前现金 ${cash}%。`;
}

function compareStrategyProfiles(profiles) {
  const defaultProfile = profiles.find((item) => item.id === "mgr-go-v1");
  const candidate = profiles.find((item) => item.id === "dma-rs-v2-atmosphere")
    || profiles.find((item) => item.id === "dma-rs-v1-candidate");
  if (!defaultProfile || !candidate) return null;
  const baseMap = Object.fromEntries(defaultProfile.targets.map((item) => [item.symbol, item.weightPct]));
  const candidateMap = Object.fromEntries(candidate.targets.map((item) => [item.symbol, item.weightPct]));
  const deltas = ["QQQ", "MU", "EWY", "TQQQ", "CASH"].map((symbol) => ({
    symbol,
    defaultWeightPct: round(baseMap[symbol] || 0, 1),
    candidateWeightPct: round(candidateMap[symbol] || 0, 1),
    deltaPct: round((candidateMap[symbol] || 0) - (baseMap[symbol] || 0), 1)
  }));
  return {
    defaultStrategyId: defaultProfile.id,
    candidateStrategyId: candidate.id,
    recommendation: "keep_mgr_go_live_track_atmosphere_candidate",
    summary: "默认仍执行 MGR-GO v1；DMA-RS v2 作为氛围融合候选策略并排跟踪。",
    deltas
  };
}

function buildDiagnostics(feature, market, events) {
  return [
    { label: "市场门控", value: `${market.state.toUpperCase()} / ${market.score}/6`, detail: "趋势、VIX、半导体相对强弱和利率变化的综合读数。" },
    { label: "VIX", value: `${round(feature.VIX.close, 2)} / 20日均 ${round(feature.VIX.sma20, 2)}`, detail: feature.VIX.close < BEST_PARAMS.vixRed ? "恐慌未进入红灯阈值。" : "VIX 触发红灯阈值。" },
    { label: "利率冲击", value: round(feature.TNX.change5, 3), detail: "10年期美债收益率 5 日变化，过快上行会压制成长股仓位。" },
    { label: "事件窗口", value: Object.entries(events).filter(([, active]) => active).map(([key]) => key).join(", ") || "无", detail: "FOMC、财报、期权到期和季末调仓会压低摆动/轮动激进度。" }
  ];
}

function buildExecutionPlan(feature, mode, market, events, targetRows) {
  const eventOn = events.fomcWindow || events.opexWindow || events.quarterWindow || events.muEarningsWindow;
  const activeEvents = Object.entries(events).filter(([, active]) => active).map(([key]) => key);
  const rows = targetRows.map((target) => buildExecutionRow(feature, mode, market, events, target));
  return {
    profile: "adaptive_guarded_open",
    title: "次日动态执行计划",
    summary: executionSummary(mode, eventOn),
    generatedFrom: "daily-close signal; next-session guarded-open execution",
    rebalanceThresholdPct: 2,
    backtest: {
      period: "2026-01-02 to 2026-06-26",
      baselineReturnPct: 84.01,
      idealCloseSignalReturnPct: 107.96,
      guardedOpenReturnPct: 118.59,
      guardedOpenMaxDrawdownPct: -16.36,
      note: "基于日线 OHLC 的执行敏感性回测，含 5 bps 单边成本；不是分钟级真实成交模拟。"
    },
    activeEventWindows: activeEvents,
    orderFormula: {
      deltaWeight: "targetWeight - currentBrokerWeight",
      tradeWhen: "abs(deltaWeight) >= 0.02",
      estimatedShares: "floor(abs(deltaWeight) * portfolioValue / referencePrice)"
    },
    globalRules: [
      "目标权重和券商实际权重差异小于 2 个百分点时不动，避免无效磨损。",
      "减仓优先于加仓；risk-off 或 TQQQ 减仓使用开盘后 5-20 分钟的可成交限价。",
      "新增 MU/TQQQ 或事件窗口内加仓，不追高开；使用开盘一半 + 第一小时/VWAP 一半，或等待回落。",
      "FOMC、MU 财报、期权到期、季末调仓窗口内，不新增额外摆动仓，只把组合拉回目标仓位。"
    ],
    rows
  };
}

function buildExecutionRow(feature, mode, market, events, target) {
  const symbol = target.symbol;
  if (symbol === "CASH") {
    return {
      symbol,
      targetWeightPct: target.weightPct,
      style: "reserve",
      primaryWindow: "不下单；作为深回撤和事件缓冲",
      orderType: "cash",
      limitBandPct: 0,
      latestGapPct: null,
      instructions: [
        target.weightPct >= 20 ? "现金仓较高，除非触发深回撤企稳，不主动买入。" : "保留流动性，等待信号或实际仓位偏离。"
      ]
    };
  }

  const highBeta = symbol === "MU" || symbol === "TQQQ";
  const gapLimitPct = highBeta ? 2.5 : 1.2;
  const limitBandPct = { QQQ: 0.35, EWY: 0.6, MU: 1.0, TQQQ: 1.2 }[symbol] || 0.6;
  const eventGuard = events.fomcWindow || events.opexWindow || events.quarterWindow || (symbol === "MU" && events.muEarningsWindow);
  const shouldAvoidNewSwing = mode === "risk-off" || eventGuard;
  const targetZero = target.weight <= 0.001;
  const addWindow = shouldAvoidNewSwing
    ? "09:45-11:30 ET 分批；若高开超过阈值，等 VWAP/第一小时后再补"
    : "09:35-09:50 ET 优先；高开超过阈值则 10:00-11:30 ET 分批";
  const reduceWindow = mode === "risk-off" || symbol === "TQQQ"
    ? "09:35-09:50 ET 优先降仓"
    : "09:35-10:30 ET；若明显高开，可开盘一半、第一小时一半";

  return {
    symbol,
    targetWeightPct: target.weightPct,
    referencePrice: target.price,
    latestGapPct: round(feature[symbol].latestGapPct, 2),
    style: targetZero ? "exit-only" : (shouldAvoidNewSwing ? "guarded-open" : "guarded-open offensive"),
    minDeltaPct: 2,
    gapLimitPct,
    limitBandPct,
    primaryWindow: targetZero ? reduceWindow : addWindow,
    orderType: `marketable limit, band ±${limitBandPct}%`,
    instructions: [
      targetZero
        ? "若券商实际权重大于 2%，下一交易日只做降仓到 0，不反手新增。"
        : `若实际权重低于目标超过 2%，按目标 ${target.weightPct}% 补仓。`,
      `若下一交易日开盘相对前收高开超过 ${gapLimitPct}%，不要全量追开盘；改为 open_mid 或 VWAP 附近分批。`,
      `若实际权重高于目标超过 2%，按 ${reduceWindow} 降到目标；risk-off 下不等待尾盘确认。`,
      shouldAvoidNewSwing ? "事件窗口内只做再平衡，不做额外摆动仓。" : "绿灯且未高开时可按开盘默认执行。"
    ]
  };
}

function executionSummary(mode, eventOn) {
  if (mode === "risk-off") return "先降风险：超目标仓位开盘优先减，新增只保留核心，不启用摆动仓。";
  if (eventOn) return "事件保护：目标仓位可执行，但新增仓位分批，避免在开盘跳空和事件前后追价。";
  return "进攻动态：默认次日开盘执行；遇到高开、MU/TQQQ 或事件窗口，改成开盘一半 + 第一小时/VWAP 一半。";
}

function buildPositioningAlerts(mode, market, events, targets) {
  const alerts = [];
  if (mode === "risk-off") {
    alerts.push({
      severity: "high",
      title: "仓位策略进入红灯",
      detail: `市场状态 ${market.state}，建议现金 ${round(targets.CASH * 100, 1)}%，TQQQ 清零。`
    });
  }
  if (events.muEarningsWindow) {
    alerts.push({
      severity: "medium",
      title: "MU 财报窗口",
      detail: "策略限制 MU 激进仓位，避免把财报缺口当作普通回撤。"
    });
  }
  if (targets.TQQQ >= 0.1) {
    alerts.push({
      severity: "medium",
      title: "TQQQ 仓位较高",
      detail: `TQQQ 目标 ${round(targets.TQQQ * 100, 1)}%，需按杠杆 ETF 处理止损和隔夜风险。`
    });
  }
  return alerts;
}

function signalTitle(mode, market, events) {
  if (mode === "risk-off") return "红灯：先保护现金";
  if (mode === "event-guard") return "事件保护：降低短线冲动";
  if (events.muEarningsWindow) return "绿灯但 MU 财报临近";
  return market.score >= 5 ? "绿灯：允许强势轮动" : "中性：保留核心仓";
}

function signalSummary(mode, targets, market, events) {
  const cash = round((targets.CASH || 0) * 100, 1);
  if (mode === "risk-off") return `VIX/利率/趋势触发红灯，现金提高到 ${cash}%，TQQQ 清零。`;
  if (mode === "event-guard") return `市场未转红，但临近关键事件，采用 QQQ 主仓 + ${cash}% 现金的保护配置。`;
  if (events.muEarningsWindow) return `市场绿灯，但 MU 财报窗口开启，避免把财报跳空风险纳入普通摆动仓。`;
  return `市场评分 ${market.score}/6，现金 ${cash}%，剩余资金按行业相对强弱轮动。`;
}

function targetName(symbol) {
  return {
    QQQ: "Nasdaq-100 核心仓",
    MU: "Micron 成长卫星",
    EWY: "韩国/存储周期分散",
    TQQQ: "3x QQQ 战术仓",
    CASH: "现金/等待仓"
  }[symbol] || symbol;
}

function targetRole(symbol, mode) {
  if (symbol === "CASH") return mode === "risk-off" ? "防守缓冲" : "机会储备";
  if (symbol === "QQQ") return "组合底座";
  if (symbol === "TQQQ") return "高波动加速器";
  return "强势轮动候选";
}

function actionText(symbol, weight, mode) {
  if (symbol === "CASH") return weight >= 0.2 ? "保留等待深回撤或事件落地" : "维持少量流动性";
  if (weight <= 0.001) return "不配置";
  if (mode === "risk-off") return "仅保留防守性小仓";
  return "按目标仓位配置，变化超过 2 个百分点再调";
}

function average(values) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return NaN;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function averageOr(values, fallback = 0) {
  const result = average(values.map((value) => Number(value)));
  return Number.isFinite(result) ? result : fallback;
}

function pctChange(values, days) {
  const current = values.at(-1);
  const previous = values.at(-1 - days);
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return 0;
  return current / previous - 1;
}

function rsi(values, period) {
  const slice = values.slice(-(period + 1));
  if (slice.length < period + 1) return NaN;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < slice.length; i += 1) {
    const change = slice[i] - slice[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

function parseDate(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function thirdFriday(year, zeroBasedMonth) {
  const date = new Date(Date.UTC(year, zeroBasedMonth, 1));
  while (date.getUTCDay() !== 5) date.setUTCDate(date.getUTCDate() + 1);
  date.setUTCDate(date.getUTCDate() + 14);
  return date;
}

function quarterEnd(date) {
  const month = date.getUTCMonth();
  const qMonth = month < 3 ? 2 : month < 6 ? 5 : month < 9 ? 8 : 11;
  return new Date(Date.UTC(date.getUTCFullYear(), qMonth + 1, 0));
}

function businessDayDistance(from, to) {
  const direction = to >= from ? 1 : -1;
  const cursor = new Date(from);
  let distance = 0;
  while (cursor.toISOString().slice(0, 10) !== to.toISOString().slice(0, 10)) {
    cursor.setUTCDate(cursor.getUTCDate() + direction);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) distance += direction;
    if (Math.abs(distance) > 10) break;
  }
  return distance;
}

function round(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return null;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function clamp(value, min, max) {
  if (!Number.isFinite(Number(value))) return min;
  return Math.max(min, Math.min(max, Number(value)));
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

module.exports = {
  buildPositioningStrategy
};
