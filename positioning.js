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

function buildRotationSignal(feature, context) {
  const market = marketState(feature);
  const events = eventRisk(feature.asOf, context.upcomingEvents);
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
  const targetRows = Object.entries(targets).map(([symbol, weight]) => ({
    symbol,
    name: targetName(symbol),
    weight,
    weightPct: round(weight * 100, 1),
    price: symbol === "CASH" ? null : round(feature[symbol].close, 2),
    role: targetRole(symbol, mode),
    score: symbol === "CASH" ? null : round(scoreSymbol(feature, symbol), 4),
    action: actionText(symbol, weight, mode)
  }));
  const executionPlan = buildExecutionPlan(feature, mode, market, events, targetRows);
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
      xlkRelativeStrong: feature.xlkSpy.value > feature.xlkSpy.sma20
    },
    events,
    targets: targetRows,
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

module.exports = {
  buildPositioningStrategy
};
