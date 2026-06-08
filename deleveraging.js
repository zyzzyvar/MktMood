const DEFAULT_TIMEOUT_MS = 12000;
const CBOE_VIX_URL = "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv";
const CBOE_VIX3M_URL = "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX3M_History.csv";
const OKX_FUNDING_URL = "https://www.okx.com/api/v5/public/funding-rate-history?instId=BTC-USDT-SWAP&limit=30";
const OKX_OI_URL = "https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-history?instId=BTC-USDT-SWAP&period=1D&limit=30";
const FINRA_MARGIN_URL = "https://www.finra.org/rules-guidance/key-topics/margin-accounts/margin-statistics";

async function fetchDeleveragingIndicators(options = {}) {
  const fetchText = options.fetchText || defaultFetchText;
  const fetchJson = options.fetchJson || defaultFetchJson;
  const tasks = [
    ["vixTerm", () => fetchVixTermIndicator(fetchText)],
    ["cryptoLeverage", () => fetchCryptoLeverageIndicators(fetchJson)],
    ["marginDebt", () => fetchMarginDebtIndicator(fetchText)]
  ];
  const settled = await Promise.all(tasks.map(async ([key, task]) => {
    try {
      return { key, ok: true, indicators: await task() };
    } catch (error) {
      return { key, ok: false, error: error.message, indicators: unavailableForSource(key, error) };
    }
  }));
  return {
    indicators: settled.flatMap((item) => item.indicators),
    sourceStatus: Object.fromEntries(settled.map((item) => [
      item.key,
      item.ok ? "ok" : `unavailable: ${item.error}`
    ]))
  };
}

async function fetchVixTermIndicator(fetchText) {
  const [vixText, vix3mText] = await Promise.all([
    fetchText(CBOE_VIX_URL),
    fetchText(CBOE_VIX3M_URL)
  ]);
  const vix = parseCboeHistory(vixText);
  const vix3m = parseCboeHistory(vix3mText);
  const vixByDate = new Map(vix.map((point) => [point.date, point.value]));
  const history = vix3m
    .map((point) => {
      const spot = vixByDate.get(point.date);
      return Number.isFinite(spot) ? { date: point.date, value: point.value - spot } : null;
    })
    .filter(Boolean)
    .slice(-90);
  if (history.length < 2) throw new Error("Cboe VIX term history is incomplete");
  const current = history.at(-1).value;
  const previous = history.at(-2).value;
  const score = current <= -2 ? -0.9 : current <= 0 ? -0.55 : current >= 2 ? 0.65 : 0.25;
  const state = scoreToState(score);
  return [{
    id: "vix_term_spread",
    name: "VIX期限结构",
    category: "市场结构与去杠杆",
    source: "Cboe",
    symbol: "VIX3M-VIX",
    status: "ok",
    unit: "点",
    value: round(current, 2),
    change: round(current - previous, 2),
    changePct: null,
    trend20: round(current - (history.at(-6)?.value ?? history[0].value), 2),
    trend60: round(current - (history.at(-21)?.value ?? history[0].value), 2),
    score: round(score, 2),
    state,
    stateLabel: stateLabel(state),
    updatedAt: `${history.at(-1).date}T21:00:00.000Z`,
    why: "VIX3M高于现货VIX通常代表期限结构正常；现货高于三个月波动率的倒挂常见于短期恐慌和强制去杠杆阶段。",
    reading: current > 0
      ? `VIX期限结构保持升水，VIX3M较现货高${round(current, 2)}点，短期恐慌没有压过中期波动率定价。`
      : `VIX期限结构倒挂，现货VIX较VIX3M高${round(Math.abs(current), 2)}点，短期保护需求和去杠杆压力仍然偏强。`,
    signals: [],
    history: history.map((point) => ({ date: point.date, value: round(point.value, 2) }))
  }];
}

async function fetchCryptoLeverageIndicators(fetchJson) {
  const [fundingJson, oiJson] = await Promise.all([
    fetchJson(OKX_FUNDING_URL),
    fetchJson(OKX_OI_URL)
  ]);
  const fundingHistory = (fundingJson.data || [])
    .map((row) => ({
      date: new Date(Number(row.fundingTime)).toISOString(),
      value: Number(row.fundingRate) * 10000
    }))
    .filter((row) => Number.isFinite(row.value))
    .reverse();
  const oiHistory = (oiJson.data || [])
    .map((row) => ({
      date: new Date(Number(row[0])).toISOString().slice(0, 10),
      value: Number(row[3]) / 1_000_000_000
    }))
    .filter((row) => Number.isFinite(row.value))
    .reverse();
  if (fundingHistory.length < 2 || oiHistory.length < 2) throw new Error("OKX leverage history is incomplete");

  const funding = fundingHistory.at(-1).value;
  const fundingPrevious = fundingHistory.at(-2).value;
  const fundingScore = funding < -1 ? -0.85 : funding < -0.2 ? -0.45 : funding <= 1.5 ? 0.35 : -0.25;
  const fundingState = scoreToState(fundingScore);
  const oi = oiHistory.at(-1).value;
  const oiPrevious = oiHistory.at(-2).value;
  const oi7 = oiHistory.at(-8)?.value ?? oiHistory[0].value;
  const oiChange = pct(oi, oiPrevious);
  const oiTrend = pct(oi, oi7);
  const oiScore = oiTrend <= -12 ? -0.8 : oiTrend <= -6 ? -0.45 : oiChange >= -2 ? 0.25 : 0;
  const oiState = scoreToState(oiScore);

  return [
    {
      id: "btc_funding",
      name: "BTC永续资金费率",
      category: "市场结构与去杠杆",
      source: "OKX",
      symbol: "BTC-USDT-SWAP",
      status: "ok",
      unit: "基点/期",
      value: round(funding, 3),
      change: round(funding - fundingPrevious, 3),
      changePct: null,
      trend20: round(funding - (fundingHistory.at(-10)?.value ?? fundingHistory[0].value), 3),
      trend60: round(funding - fundingHistory[0].value, 3),
      score: fundingScore,
      state: fundingState,
      stateLabel: stateLabel(fundingState),
      updatedAt: fundingHistory.at(-1).date,
      why: "资金费率反映永续合约多空杠杆的付费方向。明显负值常见于空头拥挤或多头清算，恢复到温和正值可作为风险偏好稳定的确认之一。",
      reading: funding < -0.2
        ? `BTC资金费率为${round(funding, 3)}基点，杠杆情绪偏空，尚不能把价格反弹直接视为去杠杆结束。`
        : funding > 1.5
          ? `BTC资金费率升至${round(funding, 3)}基点，多头付费偏高，反弹中出现重新拥挤的迹象。`
          : `BTC资金费率为${round(funding, 3)}基点，处在温和区间，衍生品情绪没有明显失衡。`,
      signals: [],
      history: fundingHistory.slice(-30).map((point) => ({ date: point.date, value: round(point.value, 3) }))
    },
    {
      id: "btc_open_interest",
      name: "BTC合约未平仓量",
      category: "市场结构与去杠杆",
      source: "OKX",
      symbol: "BTC-USDT-SWAP",
      status: "ok",
      unit: "十亿美元",
      value: round(oi, 3),
      change: round(oi - oiPrevious, 3),
      changePct: round(oiChange, 2),
      trend20: round(oiTrend, 2),
      trend60: round(pct(oi, oiHistory[0].value), 2),
      score: oiScore,
      state: oiState,
      stateLabel: stateLabel(oiState),
      updatedAt: `${oiHistory.at(-1).date}T00:00:00.000Z`,
      why: "未平仓量快速下降说明杠杆正在被清理；价格稳定后持仓量停止坍塌，比单看价格反弹更能确认去杠杆进入尾声。",
      reading: oiTrend <= -6
        ? `BTC未平仓量近7日下降${round(Math.abs(oiTrend), 1)}%，杠杆清理仍然明显。需要等待降幅收窄，并结合资金费率确认。`
        : `BTC未平仓量近7日变化${round(oiTrend, 1)}%，当前没有持续坍塌，杠杆压力较前期稳定。`,
      signals: [],
      history: oiHistory.map((point) => ({ date: point.date, value: round(point.value, 3) }))
    }
  ];
}

async function fetchMarginDebtIndicator(fetchText) {
  const html = await fetchText(FINRA_MARGIN_URL);
  const rows = parseFinraMarginRows(html);
  if (rows.length < 2) throw new Error("FINRA margin table is incomplete");
  const current = rows.at(-1);
  const previous = rows.at(-2);
  const priorYear = rows.find((row) => row.date.slice(5) === current.date.slice(5) && row.date < current.date)
    || rows.at(-13);
  const monthChange = pct(current.value, previous.value);
  const yearChange = priorYear ? pct(current.value, priorYear.value) : null;
  const score = Number.isFinite(yearChange) && yearChange >= 30
    ? -0.85
    : Number.isFinite(yearChange) && yearChange >= 15
      ? -0.55
      : monthChange >= 5
        ? -0.35
        : 0;
  const state = scoreToState(score);
  return [{
    id: "finra_margin_debt",
    name: "FINRA融资余额",
    category: "市场脆弱度",
    source: "FINRA",
    symbol: "Margin Debit",
    status: "ok",
    unit: "十亿美元",
    value: round(current.value, 1),
    change: round(current.value - previous.value, 1),
    changePct: round(monthChange, 2),
    trend20: round(monthChange, 2),
    trend60: round(yearChange, 2),
    score,
    state,
    stateLabel: stateLabel(state),
    updatedAt: `${current.date}-28T00:00:00.000Z`,
    why: "融资余额衡量股票市场杠杆背景。它按月发布且存在滞后，适合判断市场是否脆弱，不适合用来精确判断某一天的底部。",
    reading: `FINRA最新融资余额约${round(current.value, 1)}十亿美元，环比${signed(monthChange)}，同比${signed(yearChange)}。该指标只作为杠杆脆弱度背景。`,
    signals: [],
    history: rows.slice(-36).map((row) => ({ date: `${row.date}-28`, value: round(row.value, 1) }))
  }];
}

function buildStructureIndicators(indicators) {
  const byId = new Map(indicators.map((indicator) => [indicator.id, indicator]));
  return [
    buildCorrelationIndicator(byId),
    buildCtaPressureIndicator(byId)
  ];
}

function buildCorrelationIndicator(byId) {
  const ids = ["spx", "nasdaq", "rut"];
  const series = ids.map((id) => byId.get(id)).filter((item) => item?.history?.length >= 15);
  if (series.length < 2) return unavailableIndicator("cross_asset_correlation", "跨资产相关性", "Yahoo Finance derived", "基础指数历史不足");
  const maps = series.map((item) => new Map(item.history.map((point) => [point.date, Number(point.value)])));
  const dates = [...maps[0].keys()].filter((date) => maps.every((map) => Number.isFinite(map.get(date)))).sort();
  const histories = maps.map((map) => dates.map((date) => map.get(date)));
  const result = [];
  for (let end = 10; end < dates.length; end += 1) {
    const correlations = [];
    for (let left = 0; left < histories.length; left += 1) {
      for (let right = left + 1; right < histories.length; right += 1) {
        const a = returns(histories[left].slice(end - 10, end + 1));
        const b = returns(histories[right].slice(end - 10, end + 1));
        correlations.push(correlation(a, b));
      }
    }
    const value = average(correlations.filter(Number.isFinite));
    if (Number.isFinite(value)) result.push({ date: dates[end], value });
  }
  if (result.length < 2) return unavailableIndicator("cross_asset_correlation", "跨资产相关性", "Yahoo Finance derived", "无法计算相关性");
  const current = result.at(-1).value;
  const previous = result.at(-2).value;
  const score = current >= 0.85 ? -0.8 : current >= 0.72 ? -0.45 : current <= 0.5 ? 0.45 : 0;
  const state = scoreToState(score);
  return {
    id: "cross_asset_correlation",
    name: "美股指数相关性",
    category: "市场结构与去杠杆",
    source: "MktMood计算",
    symbol: "SPX/NDX/RUT",
    status: "ok",
    unit: "",
    value: round(current, 3),
    change: round(current - previous, 3),
    changePct: null,
    trend20: round(current - (result.at(-6)?.value ?? result[0].value), 3),
    trend60: round(current - (result.at(-21)?.value ?? result[0].value), 3),
    score,
    state,
    stateLabel: stateLabel(state),
    updatedAt: result.at(-1).date,
    why: "大跌时个股和指数相关性突然升高，常说明资金在无差别减仓。相关性回落意味着市场重新开始区分公司质量，是触底确认的重要组成。",
    reading: current >= 0.72
      ? `标普、纳指和罗素的10日相关性升至${round(current, 2)}，无差别交易特征较强，机械去杠杆尚未完全消退。`
      : `标普、纳指和罗素的10日相关性为${round(current, 2)}，市场开始恢复差异化定价。`,
    signals: [],
    history: result.slice(-80).map((point) => ({ date: point.date, value: round(point.value, 3) }))
  };
}

function buildCtaPressureIndicator(byId) {
  const ids = ["spx", "nasdaq", "rut"];
  const series = ids.map((id) => byId.get(id)).filter((item) => item?.history?.length >= 55);
  if (series.length < 2) return unavailableIndicator("cta_pressure_proxy", "CTA卖压代理", "MktMood model", "基础指数历史不足");
  const maps = series.map((item) => new Map(item.history.map((point) => [point.date, Number(point.value)])));
  const dates = [...maps[0].keys()].filter((date) => maps.every((map) => Number.isFinite(map.get(date)))).sort();
  const history = [];
  for (let index = 50; index < dates.length; index += 1) {
    const scores = maps.map((map) => {
      const values = dates.slice(0, index + 1).map((date) => map.get(date));
      const current = values.at(-1);
      const ma20 = average(values.slice(-20));
      const ma50 = average(values.slice(-50));
      const vol20 = standardDeviation(returns(values.slice(-21))) * Math.sqrt(252);
      const trendScore = (current >= ma20 ? 35 : -35) + (current >= ma50 ? 35 : -35);
      const volPenalty = vol20 >= 0.35 ? 30 : vol20 >= 0.25 ? 15 : 0;
      return clamp(trendScore - volPenalty, -100, 100);
    });
    history.push({ date: dates[index], value: average(scores) });
  }
  if (history.length < 2) return unavailableIndicator("cta_pressure_proxy", "CTA卖压代理", "MktMood model", "无法计算趋势代理");
  const current = history.at(-1).value;
  const previous = history.at(-2).value;
  const score = clamp(current / 100, -1, 1);
  const state = scoreToState(score);
  return {
    id: "cta_pressure_proxy",
    name: "CTA趋势卖压代理",
    category: "市场结构与去杠杆",
    source: "MktMood透明模型",
    symbol: "SPX/NDX/RUT趋势与波动",
    status: "ok",
    unit: "/100",
    value: round(current, 1),
    change: round(current - previous, 1),
    changePct: null,
    trend20: round(current - (history.at(-6)?.value ?? history[0].value), 1),
    trend60: round(current - (history.at(-21)?.value ?? history[0].value), 1),
    score: round(score, 2),
    state,
    stateLabel: stateLabel(state),
    updatedAt: history.at(-1).date,
    why: "这是可复现的趋势跟随代理：比较主要指数与20日、50日均线，并对高波动环境施加减仓惩罚。它不冒充投行的真实CTA资金流。",
    reading: current <= -40
      ? `CTA代理降至${round(current, 1)}，主要指数跌破趋势线且波动偏高，系统性策略仍可能维持卖出。`
      : current < 0
        ? `CTA代理为${round(current, 1)}，卖压仍在但已不是极端区间，关注趋势线能否重新站稳。`
        : `CTA代理回到${round(current, 1)}，趋势型策略的被动卖压明显缓和。`,
    signals: [],
    history: history.slice(-80).map((point) => ({ date: point.date, value: round(point.value, 1) }))
  };
}

function buildDeleveragingAnalysis(indicators) {
  const byId = Object.fromEntries(indicators.map((item) => [item.id, item]));
  const mechanical = [];
  const fundamental = [];
  const nasdaqChange = number(byId.nasdaq?.changePct);
  const rutChange = number(byId.rut?.changePct);
  const btc3 = periodPct(byId.btc, 3);
  const nasdaq3 = periodPct(byId.nasdaq, 3);

  addEvidence(mechanical, Number.isFinite(btc3) && Number.isFinite(nasdaq3) && btc3 <= nasdaq3 - 2,
    "加密资产领先走弱", `BTC近3期${signed(btc3)}，纳指近3期${signed(nasdaq3)}。`);
  addEvidence(mechanical, Number.isFinite(nasdaqChange) && Number.isFinite(rutChange) && nasdaqChange <= rutChange - 1,
    "拥挤成长资产领跌", `纳指单期${signed(nasdaqChange)}，弱于罗素${signed(rutChange)}。`);
  addEvidence(mechanical, Math.abs(nasdaqChange) >= 2.5 && number(byId.vix?.value) < 22,
    "跌幅与VIX反应不匹配", `纳指单期${signed(nasdaqChange)}，VIX为${formatNumber(byId.vix?.value)}。`);
  addEvidence(mechanical, number(byId.cross_asset_correlation?.value) >= 0.72,
    "相关性显著升高", `指数相关性为${formatNumber(byId.cross_asset_correlation?.value)}。`);
  addEvidence(mechanical, number(byId.btc_open_interest?.trend20) <= -6,
    "加密杠杆正在出清", `BTC未平仓量近7日${signed(byId.btc_open_interest?.trend20)}。`);

  addEvidence(fundamental, number(byId.tnx?.change) >= 0.12,
    "长端利率快速上行", `10年期收益率单期上行${formatNumber(byId.tnx?.change)}个百分点。`);
  addEvidence(fundamental, number(byId.dxy?.changePct) >= 0.8,
    "美元快速收紧", `美元指数单期${signed(byId.dxy?.changePct)}。`);
  addEvidence(fundamental, number(byId.hyg_lqd?.changePct) <= -0.45 || number(byId.hyg_lqd?.trend20) <= -1,
    "信用市场恶化", `HYG/LQD单期${signed(byId.hyg_lqd?.changePct)}，阶段${signed(byId.hyg_lqd?.trend20)}。`);
  addEvidence(fundamental, Number.isFinite(rutChange) && Number.isFinite(nasdaqChange) && rutChange <= nasdaqChange - 1,
    "经济敏感小盘股领跌", `罗素单期${signed(rutChange)}，弱于纳指${signed(nasdaqChange)}。`);

  const mechanicalScore = mechanical.length;
  const fundamentalScore = fundamental.length;
  let type = "insufficient";
  let label = "数据不足";
  if (mechanicalScore >= 2 && mechanicalScore >= fundamentalScore + 1) {
    type = "mechanical";
    label = "偏机械去杠杆";
  } else if (fundamentalScore >= 2 && fundamentalScore >= mechanicalScore + 1) {
    type = "fundamental";
    label = "偏基本面冲击";
  } else if (mechanicalScore + fundamentalScore >= 2) {
    type = "mixed";
    label = "混合型压力";
  }
  const confidence = clamp(Math.max(mechanicalScore, fundamentalScore) / 5, 0, 1);

  const confirmations = [
    confirmation("vix-contango", "VIX期限结构恢复升水",
      byId.vix_term_spread, number(byId.vix_term_spread?.value) > 0.5,
      "短期恐慌重新低于三个月波动率。"),
    confirmation("crypto-normalization", "资金费率正常且持仓停止坍塌",
      mergeAvailability(byId.btc_funding, byId.btc_open_interest),
      between(number(byId.btc_funding?.value), -0.2, 1.5)
        && number(byId.btc_open_interest?.changePct) > -2
        && periodPct(byId.btc_open_interest, 3) > -3
        && number(byId.btc_open_interest?.trend20) > -12,
      "衍生品情绪恢复，但没有重新形成过热杠杆。"),
    confirmation("cta-exhaustion", "CTA代理卖压衰减",
      byId.cta_pressure_proxy, number(byId.cta_pressure_proxy?.value) > -25,
      "主要指数趋势和波动不再触发强制减仓区。"),
    {
      id: "gamma-positive",
      label: "做市商Gamma转正",
      status: "unavailable",
      met: false,
      quality: "待接入",
      detail: "公开数据无法可靠确认做市商持仓方向；未来接入期权数据后只显示估算值。"
    },
    confirmation("correlation-breadth", "相关性回落且市场宽度改善",
      mergeAvailability(byId.cross_asset_correlation, byId.rsp_spy),
      number(byId.cross_asset_correlation?.value) < 0.72
        && (number(byId.rsp_spy?.changePct) >= 0 || number(byId.rsp_spy?.trend20) >= -0.5),
      "市场从无差别抛售恢复到差异化定价。")
  ];
  const metCount = confirmations.filter((item) => item.status === "ok" && item.met).length;
  const availableCount = confirmations.filter((item) => item.status === "ok").length;
  const vetoes = [
    veto("credit", "信用市场继续恶化",
      number(byId.hyg_lqd?.changePct) <= -0.6 || number(byId.hyg_lqd?.trend20) <= -1.2,
      `HYG/LQD单期${signed(byId.hyg_lqd?.changePct)}，阶段${signed(byId.hyg_lqd?.trend20)}。`),
    veto("volatility", "恐慌仍在扩散",
      number(byId.vix?.value) >= 30 || number(byId.vix_term_spread?.value) <= -2,
      `VIX ${formatNumber(byId.vix?.value)}，期限价差${formatNumber(byId.vix_term_spread?.value)}。`),
    veto("macro-tightening", "美元与利率同步收紧",
      number(byId.dxy?.changePct) >= 0.8 && number(byId.tnx?.change) >= 0.12,
      "美元和长端利率同时快速上行，不能只按机械去杠杆处理。")
  ].filter((item) => item.active);
  const bottom = classifyBottom(metCount, availableCount, vetoes);

  const marginYoy = number(byId.finra_margin_debt?.trend60);
  const fragilityScore = average([
    marginYoy >= 30 ? 1 : marginYoy >= 15 ? 0.65 : 0.2,
    number(byId.btc_open_interest?.trend20) <= -6 ? 0.8 : 0.3,
    number(byId.vix?.value) <= 15 ? 0.65 : 0.25
  ]);
  const fragility = {
    level: fragilityScore >= 0.7 ? "high" : fragilityScore >= 0.4 ? "medium" : "low",
    score: round(fragilityScore, 2),
    label: fragilityScore >= 0.7 ? "高脆弱度" : fragilityScore >= 0.4 ? "中等脆弱度" : "低脆弱度",
    items: [
      {
        label: "融资杠杆背景",
        status: byId.finra_margin_debt?.status || "unavailable",
        value: Number.isFinite(marginYoy) ? `同比${signed(marginYoy)}` : "不可用",
        detail: byId.finra_margin_debt?.reading || "FINRA融资余额暂不可用。"
      },
      {
        label: "加密杠杆清理",
        status: byId.btc_open_interest?.status || "unavailable",
        value: Number.isFinite(number(byId.btc_open_interest?.trend20))
          ? `7日${signed(byId.btc_open_interest?.trend20)}`
          : "不可用",
        detail: byId.btc_open_interest?.reading || "加密持仓量暂不可用。"
      },
      {
        label: "大型融资与发行日历",
        status: "pending",
        value: "待接入",
        detail: "SEC文件可以确认融资事实，但金额、结算日和真实二级市场影响需要专门解析，当前不生成伪精确分数。"
      }
    ]
  };

  return {
    id: "deleveraging-bottom",
    name: "机械去杠杆与触底确认",
    diagnosis: {
      type,
      label,
      confidence: round(confidence, 2),
      mechanicalScore,
      fundamentalScore,
      mechanicalEvidence: mechanical,
      fundamentalEvidence: fundamental,
      summary: diagnosisSummary(type, mechanical, fundamental)
    },
    fragility,
    bottom: {
      ...bottom,
      metCount,
      availableCount,
      totalCount: confirmations.length,
      confirmations,
      vetoes
    },
    dataQuality: {
      available: indicators.filter((item) => item.status === "ok").length,
      stale: indicators.filter((item) => item.status === "stale").length,
      unavailable: indicators.filter((item) => item.status === "unavailable").length,
      note: "Gamma和大型融资日历仍处于待接入状态；其余结论只使用可复现的公开数据或透明代理。"
    }
  };
}

function buildDeleveragingFramework(analysis) {
  const stageScore = analysis.bottom.stage >= 3 ? 0.45 : analysis.bottom.stage === 2 ? 0 : -0.55;
  const blockedScore = analysis.bottom.blocked ? Math.min(stageScore, -0.35) : stageScore;
  const state = scoreToState(blockedScore);
  return {
    id: analysis.id,
    kind: "deleveraging",
    name: analysis.name,
    focus: "下跌性质、杠杆脆弱度、VIX期限结构、加密衍生品、CTA代理与触底确认",
    useCase: "回答大跌更像基本面冲击还是机械去杠杆，以及现在应该避免接刀、重点观察还是小仓分批。",
    score: round(blockedScore, 2),
    state,
    stateLabel: stateLabel(state),
    summary: analysis.diagnosis.summary,
    tactical: analysis.bottom.action,
    supports: [],
    pressures: [],
    structure: analysis
  };
}

function parseCboeHistory(text) {
  return String(text)
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const [date, , , , close] = line.split(",");
      const match = date?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      const value = Number(close);
      if (!match || !Number.isFinite(value)) return null;
      return { date: `${match[3]}-${match[1]}-${match[2]}`, value };
    })
    .filter(Boolean);
}

function parseFinraMarginRows(html) {
  const text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
  const rows = [...text.matchAll(/([A-Z][a-z]{2}-\d{2})\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)/g)]
    .map((match) => {
      const date = parseMonthYear(match[1]);
      const value = Number(match[2].replace(/,/g, "")) / 1000;
      return date && Number.isFinite(value) ? { date, value } : null;
    })
    .filter(Boolean);
  return rows.reverse();
}

function parseMonthYear(value) {
  const match = String(value).match(/^([A-Z][a-z]{2})-(\d{2})$/);
  if (!match) return null;
  const months = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
  return `20${match[2]}-${months[match[1]]}`;
}

function unavailableForSource(key, error) {
  if (key === "vixTerm") {
    return [unavailableIndicator("vix_term_spread", "VIX期限结构", "Cboe", error.message)];
  }
  if (key === "cryptoLeverage") {
    return [
      unavailableIndicator("btc_funding", "BTC永续资金费率", "OKX", error.message),
      unavailableIndicator("btc_open_interest", "BTC合约未平仓量", "OKX", error.message)
    ];
  }
  return [unavailableIndicator("finra_margin_debt", "FINRA融资余额", "FINRA", error.message)];
}

function unavailableIndicator(id, name, source, error) {
  return {
    id,
    name,
    category: id === "finra_margin_debt" ? "市场脆弱度" : "市场结构与去杠杆",
    source,
    symbol: id,
    status: "unavailable",
    unit: "",
    value: null,
    change: null,
    changePct: null,
    trend20: null,
    trend60: null,
    score: 0,
    state: "missing",
    stateLabel: "数据缺失",
    updatedAt: null,
    why: "该指标用于机械去杠杆与触底确认框架。",
    reading: `${name}当前不可用，框架不会用零值代替真实数据。`,
    signals: [],
    history: [],
    error: String(error || "unknown error")
  };
}

function classifyBottom(metCount, availableCount, vetoes) {
  let stage = metCount >= 4 ? 4 : metCount >= 3 ? 3 : metCount >= 2 ? 2 : 1;
  if (availableCount < 3) stage = 0;
  const blocked = vetoes.length > 0;
  const states = {
    0: ["数据不足", "关键数据覆盖不足，暂时不能判断触底阶段。"],
    1: ["去杠杆仍在进行", "避免接刀，等待期限结构、杠杆和相关性至少出现两项改善。"],
    2: ["早期稳定", "列入重点观察，保持小仓或等待进一步确认。"],
    3: ["初步触底确认", "若没有否决条件，可考虑小仓分批，并为再次下探保留资金。"],
    4: ["较高确认", "多数机械压力已经缓和，仍需结合估值、个股基本面和仓位纪律。"]
  };
  const [label, action] = states[stage];
  return {
    stage,
    label: blocked ? `${label}（存在否决项）` : label,
    blocked,
    action: blocked ? `暂缓触底操作：${vetoes.map((item) => item.label).join("、")}。` : action
  };
}

function diagnosisSummary(type, mechanical, fundamental) {
  if (type === "mechanical") {
    return `当前更像机械去杠杆，已出现${mechanical.length}项证据。重点不是猜最低点，而是等待强制卖压和相关性回落。`;
  }
  if (type === "fundamental") {
    return `当前更像基本面或宏观冲击，已出现${fundamental.length}项证据。单纯等待技术性反弹不足以确认风险结束。`;
  }
  if (type === "mixed") {
    return `机械卖压与基本面压力同时存在。即使强制卖盘缓和，也要继续检查利率、美元和信用市场。`;
  }
  return "当前可验证证据不足，不能仅凭新闻叙事判断大跌性质。";
}

function confirmation(id, label, indicator, met, detail) {
  const available = indicator?.status === "ok";
  return {
    id,
    label,
    status: available ? "ok" : "unavailable",
    met: available && Boolean(met),
    quality: available ? "公开数据/透明计算" : "数据不足",
    detail: available ? detail : "相关数据暂不可用，本项不计入确认数量。"
  };
}

function mergeAvailability(...items) {
  return { status: items.every((item) => item?.status === "ok") ? "ok" : "unavailable" };
}

function veto(id, label, active, detail) {
  return { id, label, active: Boolean(active), detail };
}

function addEvidence(target, active, label, detail) {
  if (active) target.push({ label, detail });
}

function periodPct(indicator, periods) {
  const history = indicator?.history || [];
  if (history.length < periods + 1) return null;
  return pct(number(history.at(-1)?.value), number(history.at(-(periods + 1))?.value));
}

function returns(values) {
  return values.slice(1).map((value, index) => pct(value, values[index]) / 100);
}

function correlation(a, b) {
  if (a.length !== b.length || a.length < 3) return null;
  const meanA = average(a);
  const meanB = average(b);
  let numerator = 0;
  let sumA = 0;
  let sumB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index] - meanA;
    const right = b[index] - meanB;
    numerator += left * right;
    sumA += left ** 2;
    sumB += right ** 2;
  }
  const denominator = Math.sqrt(sumA * sumB);
  return denominator ? numerator / denominator : null;
}

function standardDeviation(values) {
  if (!values.length) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function average(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function between(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function pct(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return NaN;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function signed(value) {
  const parsed = number(value);
  if (!Number.isFinite(parsed)) return "--";
  return `${parsed > 0 ? "+" : ""}${round(parsed, 2)}%`;
}

function formatNumber(value) {
  const parsed = number(value);
  return Number.isFinite(parsed) ? String(round(parsed, 2)) : "--";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return null;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function scoreToState(score) {
  if (score >= 0.25) return "supportive";
  if (score <= -0.25) return "pressure";
  return "neutral";
}

function stateLabel(state) {
  return { supportive: "支撑", pressure: "压力", neutral: "中性", missing: "数据缺失" }[state] || "中性";
}

async function defaultFetchText(url) {
  const response = await fetchWithTimeout(url);
  return response.text();
}

async function defaultFetchJson(url) {
  const response = await fetchWithTimeout(url);
  return response.json();
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "MktMood/1.0 market-structure-monitor",
        Accept: "*/*"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  fetchDeleveragingIndicators,
  buildStructureIndicators,
  buildDeleveragingAnalysis,
  buildDeleveragingFramework,
  parseCboeHistory,
  parseFinraMarginRows
};
