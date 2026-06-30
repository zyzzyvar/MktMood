const state = {
  snapshot: null,
  selectedFramework: "liquidity-risk",
  selectedCategory: "全部",
  eventFilter: "全部",
  anomalyFilter: "全部",
  agentType: "generic",
  agentSeverity: "high",
  agentLimit: "10",
  loadingTimer: null,
  loadingIndex: 0
};

const loadingPlan = [
  "连接后端服务",
  "拉取股指、美元、黄金、利率等行情",
  "拉取宏观序列和情绪指标",
  "扫描未来 7 天宏观和财报事件",
  "扫描全市场个股异动",
  "扫描行业与主题板块 ETF",
  "读取数据库历史观察",
  "计算突破、持续变化和预测修正",
  "写入 PostgreSQL 并渲染页面"
];

const els = {
  updatedAt: document.querySelector("#updatedAt"),
  marketScore: document.querySelector("#marketScore"),
  scoreRing: document.querySelector("#scoreRing"),
  regimeName: document.querySelector("#regimeName"),
  regimeDescription: document.querySelector("#regimeDescription"),
  riskStatus: document.querySelector("#riskStatus"),
  riskRegimeName: document.querySelector("#riskRegimeName"),
  riskRegimeScore: document.querySelector("#riskRegimeScore"),
  flagStrip: document.querySelector("#flagStrip"),
  positionStatus: document.querySelector("#positionStatus"),
  positionMode: document.querySelector("#positionMode"),
  positionTitle: document.querySelector("#positionTitle"),
  positionSummary: document.querySelector("#positionSummary"),
  positionDiagnostics: document.querySelector("#positionDiagnostics"),
  positionTargets: document.querySelector("#positionTargets"),
  positionProfiles: document.querySelector("#positionProfiles"),
  positionExecution: document.querySelector("#positionExecution"),
  eventSummary: document.querySelector("#eventSummary"),
  macroEvents: document.querySelector("#macroEvents"),
  earningsEvents: document.querySelector("#earningsEvents"),
  anomalySummary: document.querySelector("#anomalySummary"),
  equityAnomalies: document.querySelector("#equityAnomalies"),
  sectorMoves: document.querySelector("#sectorMoves"),
  loadingOverlay: document.querySelector("#loadingOverlay"),
  loadingPercent: document.querySelector("#loadingPercent"),
  loadingBar: document.querySelector("#loadingBar"),
  loadingStep: document.querySelector("#loadingStep"),
  loadingSteps: document.querySelector("#loadingSteps"),
  frameworkTabs: document.querySelector("#frameworkTabs"),
  frameworkPanel: document.querySelector("#frameworkPanel"),
  dimensionList: document.querySelector("#dimensionList"),
  categoryFilters: document.querySelector("#categoryFilters"),
  indicatorTable: document.querySelector("#indicatorTable"),
  refreshButton: document.querySelector("#refreshButton"),
  agentCenterButton: document.querySelector("#agentCenterButton"),
  agentModal: document.querySelector("#agentModal"),
  agentModalClose: document.querySelector("#agentModalClose"),
  agentTypeSelect: document.querySelector("#agentTypeSelect"),
  agentSeveritySelect: document.querySelector("#agentSeveritySelect"),
  agentLimitSelect: document.querySelector("#agentLimitSelect"),
  agentMonitorUrl: document.querySelector("#agentMonitorUrl"),
  agentPromptText: document.querySelector("#agentPromptText"),
  copyAgentUrl: document.querySelector("#copyAgentUrl"),
  copyAgentPrompt: document.querySelector("#copyAgentPrompt"),
  testAgentMonitor: document.querySelector("#testAgentMonitor"),
  agentTestResult: document.querySelector("#agentTestResult"),
  sparklineTemplate: document.querySelector("#sparklineTemplate")
};

els.refreshButton.addEventListener("click", () => loadSnapshot(true));
els.agentCenterButton.addEventListener("click", openAgentCenter);
els.agentModalClose.addEventListener("click", closeAgentCenter);
els.agentModal.addEventListener("click", (event) => {
  if (event.target === els.agentModal) closeAgentCenter();
});
els.agentTypeSelect.addEventListener("change", () => {
  state.agentType = els.agentTypeSelect.value;
  renderAgentCenter();
});
els.agentSeveritySelect.addEventListener("change", () => {
  state.agentSeverity = els.agentSeveritySelect.value;
  renderAgentCenter();
});
els.agentLimitSelect.addEventListener("change", () => {
  state.agentLimit = els.agentLimitSelect.value;
  renderAgentCenter();
});
els.copyAgentUrl.addEventListener("click", () => copyText(els.agentMonitorUrl.textContent, els.copyAgentUrl));
els.copyAgentPrompt.addEventListener("click", () => copyText(els.agentPromptText.textContent, els.copyAgentPrompt));
els.testAgentMonitor.addEventListener("click", testAgentMonitor);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.agentModal.hidden) closeAgentCenter();
});

loadSnapshot();

async function loadSnapshot(force = false) {
  startLoadingProgress();
  setLoading();
  try {
    const response = await fetch(`/api/snapshot${force ? `?t=${Date.now()}` : ""}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.snapshot = await response.json();
    if (!state.snapshot.frameworks.some((item) => item.id === state.selectedFramework)) {
      state.selectedFramework = state.snapshot.frameworks[0]?.id;
    }
    render();
  } catch (error) {
    els.indicatorTable.innerHTML = `<div class="error">数据加载失败：${escapeHtml(error.message)}</div>`;
  } finally {
    stopLoadingProgress();
  }
}

function setLoading() {
  if (!state.snapshot) {
    els.indicatorTable.innerHTML = `<div class="loading">正在请求市场数据源...</div>`;
  }
}

function render() {
  const { snapshot } = state;
  els.updatedAt.textContent = formatDateTime(snapshot.updatedAt);
  els.marketScore.textContent = formatScore(snapshot.marketScore);
  const riskRegime = snapshot.riskRegime || { name: "风险状态未知", level: "calm", score: null, description: "" };
  els.regimeName.textContent = riskRegime.level === "calm"
    ? snapshot.regime.name
    : `${snapshot.regime.name} · ${riskRegime.name}`;
  els.riskRegimeName.textContent = riskRegime.name;
  els.riskRegimeScore.textContent = `风险温度 ${Number.isFinite(Number(riskRegime.score)) ? riskRegime.score : "--"}`;
  els.riskStatus.className = `risk-status ${escapeHtml(riskRegime.level || "calm")}`;
  els.regimeDescription.textContent = riskRegime.description
    ? `${snapshot.regime.description} ${riskRegime.description}`
    : snapshot.regime.description;
  renderScoreRing(snapshot.marketScore);
  renderFlags(snapshot.flags);
  renderPositioning(snapshot.positioning);
  renderEventRadar(snapshot.upcomingEvents);
  renderAnomalyRadar(snapshot.anomalyRadar);
  renderFrameworkTabs(snapshot.frameworks);
  renderFrameworkPanel(snapshot.frameworks);
  renderDimensions(snapshot.dimensions);
  renderCategoryFilters(snapshot.indicators);
  renderIndicators(snapshot.indicators);
}

function renderPositioning(positioning) {
  if (!positioning || positioning.status !== "ok") {
    els.positionStatus.innerHTML = `<span class="pill missing">不可用</span>`;
    els.positionMode.className = "pill missing";
    els.positionMode.textContent = "不可用";
    els.positionTitle.textContent = positioning?.title || "仓位策略暂不可用";
    els.positionSummary.textContent = positioning?.summary || positioning?.error || "没有可用仓位信号。";
    els.positionDiagnostics.innerHTML = "";
    els.positionTargets.innerHTML = `<div class="event-empty warning">仓位策略数据暂不可用，请稍后刷新。</div>`;
    els.positionProfiles.innerHTML = "";
    els.positionExecution.innerHTML = "";
    return;
  }

  const modeClass = positioning.mode === "risk-off"
    ? "pressure"
    : positioning.mode === "green-rotation"
      ? "supportive"
      : "neutral";
  els.positionStatus.innerHTML = `
    <span class="pill ${modeClass}">${escapeHtml(positioning.state.marketState.toUpperCase())}</span>
    <span class="pill neutral">${escapeHtml(positioning.asOf || "--")}</span>
  `;
  els.positionMode.className = `pill ${modeClass}`;
  els.positionMode.textContent = positioning.mode === "green-rotation"
    ? "强势轮动"
    : positioning.mode === "risk-off"
      ? "风险防守"
      : "事件保护";
  els.positionTitle.textContent = positioning.title;
  els.positionSummary.textContent = positioning.summary;
  els.positionDiagnostics.innerHTML = (positioning.diagnostics || []).map((item) => `
    <div class="position-diagnostic">
      <span>${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.value)}</strong>
      <small>${escapeHtml(item.detail)}</small>
    </div>
  `).join("");
  els.positionTargets.innerHTML = (positioning.targets || []).map((target) => {
    const weight = Number(target.weightPct || 0);
    const barClass = target.symbol === "CASH"
      ? "cash"
      : weight >= 30
        ? "heavy"
        : "normal";
    return `
      <div class="position-target ${barClass}">
        <div class="position-target-head">
          <div>
            <strong>${escapeHtml(target.symbol)}</strong>
            <span>${escapeHtml(target.name)}</span>
          </div>
          <b>${formatPercent(weight)}</b>
        </div>
        <div class="bar position-bar"><span style="width:${Math.max(2, Math.min(100, weight))}%"></span></div>
        <div class="position-target-meta">
          <span>${escapeHtml(target.role)}</span>
          <span>${target.price ? `价格 ${formatNumber(target.price)}` : "现金"}</span>
          <span>${escapeHtml(target.action)}</span>
        </div>
      </div>
    `;
  }).join("");
  renderPositionProfiles(positioning.strategyProfiles, positioning.strategyComparison);
  renderPositionExecution(positioning.executionPlan);
}

function renderPositionProfiles(profiles = [], comparison) {
  if (!profiles.length) {
    els.positionProfiles.innerHTML = "";
    return;
  }
  const comparisonRows = comparison?.deltas || [];
  const candidate = profiles.find((profile) => profile.id === comparison?.candidateStrategyId)
    || profiles.find((profile) => profile.id !== comparison?.defaultStrategyId);
  els.positionProfiles.innerHTML = `
    <div class="profile-head">
      <div>
        <p class="section-kicker">Strategy Profiles</p>
        <h3>MGR-GO v1 vs ${escapeHtml(candidate?.name || "Candidates")}</h3>
        <p>${escapeHtml(comparison?.summary || "候选策略与默认策略并排跟踪。")}</p>
      </div>
      <span class="pill neutral">${escapeHtml(comparison?.recommendation || "paper tracking")}</span>
    </div>
    <div class="profile-grid">
      ${profiles.map(renderStrategyProfile).join("")}
    </div>
    <div class="profile-delta-table">
      ${comparisonRows.map((row) => `
        <div>
          <strong>${escapeHtml(row.symbol)}</strong>
          <span>默认 ${formatPercent(row.defaultWeightPct)}</span>
          <span>候选 ${formatPercent(row.candidateWeightPct)}</span>
          <b class="${Number(row.deltaPct) >= 0 ? "up" : "down"}">${Number(row.deltaPct) >= 0 ? "+" : ""}${formatNumber(row.deltaPct)}%</b>
        </div>
      `).join("")}
    </div>
  `;
}

function renderStrategyProfile(profile) {
  const statusClass = profile.status === "deployed_default" ? "supportive" : "neutral";
  const sleeves = profile.sleeves;
  const drivers = profile.drivers || [];
  return `
    <article class="profile-card">
      <div class="profile-title-row">
        <strong>${escapeHtml(profile.name)}</strong>
        <span class="pill ${statusClass}">${escapeHtml(profile.status)}</span>
      </div>
      <p>${escapeHtml(profile.summary || "")}</p>
      <div class="profile-meta">
        <span>phase: ${escapeHtml(profile.phase || "--")}</span>
        <span>${escapeHtml(profile.backtest?.validation || "--")}</span>
      </div>
      ${renderProfileDiagnostics(profile.diagnostics)}
      ${sleeves ? `
        <div class="profile-sleeves">
          <span>core ${formatPercent(sleeves.coreHoldPct)}</span>
          <span>swing ${formatPercent(sleeves.swingPct)}</span>
          <span>cash ${formatPercent(sleeves.reserveCashPct)}</span>
        </div>
      ` : ""}
      <div class="profile-weights">
        ${(profile.targets || []).map((target) => `
          <span>${escapeHtml(target.symbol)} ${formatPercent(target.weightPct)}</span>
        `).join("")}
      </div>
      ${drivers.length ? `
        <ul class="profile-drivers">
          ${drivers.slice(0, 6).map((driver) => `<li>${escapeHtml(driver)}</li>`).join("")}
        </ul>
      ` : ""}
    </article>
  `;
}

function renderProfileDiagnostics(diagnostics) {
  if (!diagnostics) return "";
  return `
    <div class="profile-diagnostics-mini">
      ${Object.entries(diagnostics).slice(0, 8).map(([key, value]) => `
        <span>${escapeHtml(key)} ${formatNumber(value)}</span>
      `).join("")}
    </div>
  `;
}

function renderPositionExecution(plan) {
  if (!plan) {
    els.positionExecution.innerHTML = "";
    return;
  }
  const rows = plan.rows || [];
  els.positionExecution.innerHTML = `
    <div class="execution-head">
      <div>
        <p class="section-kicker">Execution Plan</p>
        <h3>${escapeHtml(plan.title || "动态执行计划")}</h3>
        <p>${escapeHtml(plan.summary || "")}</p>
      </div>
      <div class="execution-stats">
        <span>阈值 ${formatPercent(plan.rebalanceThresholdPct || 0)}</span>
        <span>回测 ${formatNumber(plan.backtest?.guardedOpenReturnPct || 0)}%</span>
        <span>最大回撤 ${formatNumber(plan.backtest?.guardedOpenMaxDrawdownPct || 0)}%</span>
      </div>
    </div>
    <div class="execution-rules">
      ${(plan.globalRules || []).map((rule) => `<span>${escapeHtml(rule)}</span>`).join("")}
    </div>
    <div class="execution-grid">
      ${rows.map(renderExecutionRow).join("")}
    </div>
  `;
}

function renderExecutionRow(row) {
  const isCash = row.symbol === "CASH";
  const gap = Number.isFinite(Number(row.latestGapPct)) ? `${formatNumber(row.latestGapPct)}% 最新日跳空` : "现金";
  const target = Number.isFinite(Number(row.targetWeightPct)) ? formatPercent(row.targetWeightPct) : "--";
  return `
    <article class="execution-card ${isCash ? "cash" : ""}">
      <div class="execution-card-head">
        <strong>${escapeHtml(row.symbol)}</strong>
        <b>${target}</b>
      </div>
      <div class="execution-meta">
        <span>${escapeHtml(row.style || "--")}</span>
        <span>${escapeHtml(row.primaryWindow || "--")}</span>
        <span>${escapeHtml(row.orderType || "--")}</span>
        <span>${escapeHtml(gap)}</span>
      </div>
      <ul>
        ${(row.instructions || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </article>
  `;
}

function openAgentCenter() {
  els.agentModal.hidden = false;
  renderAgentCenter();
}

function closeAgentCenter() {
  els.agentModal.hidden = true;
}

function renderAgentCenter() {
  const config = getAgentConfig();
  els.agentMonitorUrl.textContent = config.url;
  els.agentPromptText.textContent = buildAgentPrompt(config);
  els.agentTestResult.textContent = "尚未测试";
  els.agentTestResult.className = "agent-test-result";
}

function getAgentConfig() {
  const base = window.location.origin;
  const severity = state.agentSeverity;
  const limit = state.agentLimit;
  return {
    type: state.agentType,
    severity,
    limit,
    url: `${base}/api/hermes/monitor?minSeverity=${encodeURIComponent(severity)}&limit=${encodeURIComponent(limit)}`,
    healthUrl: `${base}/api/health`,
    contextUrl: `${base}/api/agent/context?framework=liquidity-risk`,
    cadence: severity === "low" ? "每 30 分钟" : "每小时"
  };
}

function buildAgentPrompt(config) {
  const severityText = {
    high: "只提醒高优先级事项",
    medium: "提醒高优先级和中等优先级事项",
    low: "提醒所有可观察事项，适合调试或高敏感监控"
  }[config.severity] || "只提醒高优先级事项";
  const common = [
    "你是我的市场监控 Agent。",
    `请${config.cadence}调用 MktMood 监控接口：`,
    config.url,
    "",
    `提醒策略：${severityText}。`,
    "如果 shouldNotify=false，不要发送消息。",
    "如果 shouldNotify=true，请读取 alerts、telegramText 和 dedupeKeys。",
    "请用 dedupeKeys 去重，只发送之前没有发送过的新事项；dedupeKeys 建议保存 1-3 天。",
    "默认直接发送 telegramText；如果你要重排消息，请保留每条 alert 的 severity、title、detail 和 actionHint。",
    "如果接口失败，请先调用健康检查接口确认服务状态：",
    config.healthUrl
  ];

  if (config.type === "hermes") {
    return [
      ...common,
      "",
      "Hermes 执行要求：",
      "1. 使用 Telegram 作为通知渠道。",
      "2. shouldNotify=true 且存在新 dedupeKey 时才发消息。",
      "3. Telegram 正文优先使用 response.telegramText。",
      "4. 如果连续 3 次接口失败，再发送一次服务异常提醒；不要每次失败都刷屏。"
    ].join("\n");
  }

  if (config.type === "openclaw") {
    return [
      ...common,
      "",
      "OpenClaw 执行要求：",
      "1. 创建一个周期性任务，按上述频率调用接口。",
      "2. 把 dedupeKeys 存入任务状态或持久化存储。",
      "3. 当 alerts 中出现 indicator_signal、leader_anomaly、sector_move 或 event_due 时，优先提醒。",
      "4. 需要更完整上下文时，再调用：",
      config.contextUrl
    ].join("\n");
  }

  if (config.type === "shell") {
    return [
      "# Cron / Shell 示例",
      `# ${config.cadence}调用一次，拿到 JSON 后由你的脚本判断 shouldNotify 和 dedupeKeys。`,
      `curl --max-time 45 "${config.url}"`,
      "",
      "# 健康检查",
      `curl --max-time 10 "${config.healthUrl}"`
    ].join("\n");
  }

  return [
    ...common,
    "",
    "你不需要预测市场，只需要忠实执行监控、去重和提醒。遇到交易含义不明确的事项，请把它表述成“需要关注/核验”，不要直接给买卖建议。"
  ].join("\n");
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    flashButton(button, "已复制");
  } catch {
    flashButton(button, "复制失败");
  }
}

function flashButton(button, text) {
  const original = button.textContent;
  button.textContent = text;
  window.setTimeout(() => {
    button.textContent = original;
  }, 1400);
}

async function testAgentMonitor() {
  const config = getAgentConfig();
  els.agentTestResult.textContent = "正在测试...";
  els.agentTestResult.className = "agent-test-result";
  try {
    const response = await fetch(config.url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    els.agentTestResult.className = `agent-test-result ${data.shouldNotify ? "warning" : "ok"}`;
    els.agentTestResult.textContent = `接口可用 · shouldNotify=${Boolean(data.shouldNotify)} · alertCount=${data.alertCount ?? 0}`;
  } catch (error) {
    els.agentTestResult.className = "agent-test-result error";
    els.agentTestResult.textContent = `接口失败：${error.message}`;
  }
}

function renderScoreRing(score) {
  const degrees = Math.round(((score + 1) / 2) * 360);
  const color = score > 0.25 ? "var(--green)" : score < -0.25 ? "var(--red)" : "var(--blue)";
  els.scoreRing.style.background = `radial-gradient(circle at center, #fff 0 57%, transparent 58%), conic-gradient(${color} 0deg, ${color} ${degrees}deg, #dfe6ee ${degrees + 1}deg)`;
}

function renderFlags(flags) {
  els.flagStrip.innerHTML = flags
    .map(
      (flag) => `
        <div class="flag ${flag.level}">
          <strong>${escapeHtml(flag.title)}</strong>
          <span>${escapeHtml(flag.detail)}</span>
        </div>
      `
    )
    .join("");
}

function renderAnomalyRadar(anomalyRadar) {
  if (!anomalyRadar) return;
  const equities = anomalyRadar.equityAnomalies?.filter((item) => item.status === "ok") || [];
  const sectors = anomalyRadar.sectorMoves?.filter((item) => item.status === "ok") || [];
  const leaders = anomalyRadar.legacyLeaderAlerts || [];
  const unavailableEquities = anomalyRadar.equityAnomalies?.filter((item) => item.status === "unavailable") || [];
  const unavailableSectors = anomalyRadar.sectorMoves?.filter((item) => item.status === "unavailable") || [];
  const visible = filterAnomalies(equities, sectors, leaders);
  const filters = [
    { label: "全部", count: Math.min(equities.length, 10) + Math.min(sectors.length, 8) },
    { label: "龙头", count: Math.min(leaders.length, 10) },
    { label: "个股", count: Math.min(equities.length, 10) },
    { label: "板块", count: Math.min(sectors.length, 8) }
  ];
  els.anomalySummary.innerHTML = filters.map((filter) => `
    <button type="button" class="pill event-filter ${state.anomalyFilter === filter.label ? "active" : "neutral"}" data-anomaly-filter="${filter.label}">
      ${filter.label} ${filter.count}
    </button>
  `).join("");
  els.anomalySummary.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.anomalyFilter = button.dataset.anomalyFilter;
      renderAnomalyRadar(state.snapshot.anomalyRadar);
    });
  });
  els.equityAnomalies.innerHTML = visible.equities.length
    ? visible.equities.slice(0, 10).map(renderEquityAnomaly).join("")
    : renderAnomalyEmpty("暂无全市场显著个股异动。", unavailableEquities);
  els.sectorMoves.innerHTML = visible.sectors.length
    ? visible.sectors.slice(0, 8).map(renderSectorMove).join("")
    : renderAnomalyEmpty("暂无显著行业/板块异动。", unavailableSectors);
}

function renderAnomalyEmpty(defaultText, unavailableItems) {
  if (unavailableItems.length) {
    return `<div class="event-empty warning">${escapeHtml(unavailableItems[0].explanation || "异动数据源暂时不可用，请稍后刷新。")}</div>`;
  }
  return `<div class="event-empty">${escapeHtml(defaultText)}</div>`;
}

function filterAnomalies(equities, sectors, leaders) {
  if (state.anomalyFilter === "龙头") return { equities: leaders, sectors: [] };
  if (state.anomalyFilter === "个股") return { equities, sectors: [] };
  if (state.anomalyFilter === "板块") return { equities: [], sectors };
  return { equities, sectors };
}

function renderEquityAnomaly(item) {
  const directionClass = item.direction === "down" ? "down" : "up";
  return `
    <article class="event-card ${escapeHtml(item.severity || "medium")}">
      <div class="event-date">
        <strong class="${directionClass}">${formatNumber(item.changePct)}%</strong>
        <span>${escapeHtml(item.symbol)}</span>
      </div>
      <div class="event-body">
        <div class="event-title">
          <strong>${escapeHtml(item.name)}</strong>
          <span class="pill ${item.isTraditionalLeader ? "pressure" : "neutral"}">${escapeHtml(item.classification)}</span>
        </div>
        <p class="company-brief">${escapeHtml(item.companyBrief || "暂无公司简介。")}</p>
        <p>${escapeHtml(item.explanation)}</p>
        <div class="event-meta">
          <span>${escapeHtml(item.marketLabel || "股票市场")}</span>
          <span>${escapeHtml(item.sectorLabel || "未分类")}</span>
          <span>${escapeHtml(item.industryLabel || "行业待确认")}</span>
          <span>波动倍数：${formatNumber(item.abnormalMoveRatio)}</span>
          <span>量比：${formatNumber(item.volumeRatio)}</span>
        </div>
      </div>
    </article>
  `;
}

function renderSectorMove(item) {
  const directionClass = item.direction === "down" ? "down" : "up";
  return `
    <article class="event-card ${escapeHtml(item.severity || "medium")}">
      <div class="event-date">
        <strong class="${directionClass}">${formatNumber(item.changePct)}%</strong>
        <span>${escapeHtml(item.symbol)}</span>
      </div>
      <div class="event-body">
        <div class="event-title">
          <strong>${escapeHtml(item.name)}</strong>
          <span class="pill neutral">${escapeHtml(item.group)}</span>
        </div>
        <p>${escapeHtml(item.explanation)}</p>
        <div class="event-meta">
          <span>20日：${formatNumber(item.trend20)}%</span>
          <span>波动倍数：${formatNumber(item.abnormalMoveRatio)}</span>
        </div>
      </div>
    </article>
  `;
}

function renderEventRadar(upcomingEvents) {
  if (!upcomingEvents) return;
  const highCount = upcomingEvents.highAttention?.length || 0;
  const macroCount = upcomingEvents.macro?.filter((event) => event.status === "ok").length || 0;
  const earningsCount = upcomingEvents.earnings?.filter((event) => event.status === "ok").length || 0;
  const highKeys = new Set((upcomingEvents.highAttention || []).map((event) => eventKey(event)));
  const macroEvents = state.eventFilter === "财报"
    ? []
    : state.eventFilter === "重点"
      ? (upcomingEvents.macro || []).filter((event) => highKeys.has(eventKey(event)))
      : (upcomingEvents.macro || []);
  const earningsEvents = state.eventFilter === "宏观"
    ? []
    : state.eventFilter === "重点"
      ? (upcomingEvents.earnings || []).filter((event) => highKeys.has(eventKey(event)))
      : (upcomingEvents.earnings || []);
  const filters = [
    { label: "全部", count: Math.min(macroCount, 8) + Math.min(earningsCount, 8) },
    { label: "重点", count: displayedCountForEvents(upcomingEvents, "重点", highKeys) },
    { label: "宏观", count: Math.min(macroCount, 8) },
    { label: "财报", count: Math.min(earningsCount, 8) }
  ];
  els.eventSummary.innerHTML = filters.map((filter) => `
    <button type="button" class="pill event-filter ${state.eventFilter === filter.label ? "active" : "neutral"}" data-event-filter="${filter.label}">
      ${filter.label} ${filter.count}
    </button>
  `).join("");
  els.eventSummary.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.eventFilter = button.dataset.eventFilter;
      renderEventRadar(state.snapshot.upcomingEvents);
    });
  });
  els.macroEvents.innerHTML = renderEventList(macroEvents, "macro");
  els.earningsEvents.innerHTML = renderEventList(earningsEvents, "earnings");
}

function displayedCountForEvents(upcomingEvents, filter, highKeys) {
  const macro = filter === "财报"
    ? []
    : filter === "重点"
      ? (upcomingEvents.macro || []).filter((event) => highKeys.has(eventKey(event)))
      : (upcomingEvents.macro || []);
  const earnings = filter === "宏观"
    ? []
    : filter === "重点"
      ? (upcomingEvents.earnings || []).filter((event) => highKeys.has(eventKey(event)))
      : (upcomingEvents.earnings || []);
  return macro.filter((event) => event.status === "ok").slice(0, 8).length
    + earnings.filter((event) => event.status === "ok").slice(0, 8).length;
}

function renderEventList(events, kind) {
  const live = events.filter((event) => event.status === "ok");
  if (!live.length) {
    const fallback = events.find((event) => event.status !== "ok");
    return `<div class="event-empty">${escapeHtml(fallback?.watchText || "未来 7 天暂无重点事件。")}</div>`;
  }
  return live.slice(0, 8).map((event) => `
    <article class="event-card ${escapeHtml(event.priority || "medium")}">
      <div class="event-date">
        <strong>${escapeHtml(formatEventDay(event.daysUntil))}</strong>
        <span>${escapeHtml(event.date)} ${escapeHtml(event.time || "")}</span>
      </div>
      <div class="event-body">
        <div class="event-title">
          <strong>${escapeHtml(event.title)}</strong>
          <span class="pill ${event.priority === "high" ? "pressure" : "neutral"}">${escapeHtml(kind === "earnings" ? event.sector : event.theme)}</span>
        </div>
        <p>${escapeHtml(event.watchText)}</p>
        ${kind === "macro" ? renderMacroInterpretation(event.interpretation) : ""}
        ${renderEventRevisions(event.revisions || [])}
        <div class="event-meta">
          <span>预测：${escapeHtml(event.expectation || "暂无")}</span>
          ${kind === "macro" ? `<span>前值：${escapeHtml(event.previous || "暂无")}</span>` : `<span>分析师数：${escapeHtml(event.noOfEsts || "N/A")}</span>`}
        </div>
      </div>
    </article>
  `).join("");
}

function renderMacroInterpretation(interpretation) {
  if (!interpretation) return "";
  return `
    <details class="event-interpretation">
      <summary>指标解读与操作关注</summary>
      <div class="interpretation-grid">
        <p><strong>这是什么：</strong>${escapeHtml(interpretation.plain)}</p>
        <p><strong>为什么重要：</strong>${escapeHtml(interpretation.professional)}</p>
        <p><strong>高于预期：</strong>${escapeHtml(interpretation.higherThanExpected)}</p>
        <p><strong>低于预期：</strong>${escapeHtml(interpretation.lowerThanExpected)}</p>
        <p><strong>大幅偏高：</strong>${escapeHtml(interpretation.largePositiveSurprise)}</p>
        <p><strong>大幅偏低：</strong>${escapeHtml(interpretation.largeNegativeSurprise)}</p>
        <p><strong>操作关注：</strong>${escapeHtml(interpretation.actionHint)}</p>
        <p><strong>重点观察：</strong>${escapeHtml((interpretation.watchAssets || []).join(" / "))}</p>
      </div>
    </details>
  `;
}

function renderEventRevisions(revisions) {
  if (!revisions.length) return "";
  return `
    <div class="signal-list">
      ${revisions.slice(0, 2).map((revision) => `
        <span class="signal-chip ${escapeHtml(revision.direction)} ${escapeHtml(revision.severity)}" title="${escapeHtml(revision.detail)}">
          ${escapeHtml(revision.fieldLabel)}${revision.direction === "up" ? "上修" : revision.direction === "down" ? "下修" : "变化"}
        </span>
      `).join("")}
    </div>
  `;
}

function formatEventDay(daysUntil) {
  if (daysUntil === 0) return "今天";
  if (daysUntil === 1) return "明天";
  return `${daysUntil} 天后`;
}

function eventKey(event) {
  if (event.type === "earnings") return `earnings:${event.symbol}:${event.date}`;
  return `macro:${event.symbol || slug(event.title)}:${event.date}:${event.reference || ""}`;
}

function slug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function renderFrameworkTabs(frameworks) {
  els.frameworkTabs.innerHTML = frameworks
    .map(
      (framework) => `
        <button type="button" class="${framework.id === state.selectedFramework ? "active" : ""}" data-framework="${framework.id}">
          ${escapeHtml(framework.name)}
        </button>
      `
    )
    .join("");
  els.frameworkTabs.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedFramework = button.dataset.framework;
      renderFrameworkTabs(state.snapshot.frameworks);
      renderFrameworkPanel(state.snapshot.frameworks);
    });
  });
}

function renderFrameworkPanel(frameworks) {
  const framework = frameworks.find((item) => item.id === state.selectedFramework) || frameworks[0];
  if (framework.kind === "deleveraging" && framework.structure) {
    els.frameworkPanel.innerHTML = renderDeleveragingFramework(framework);
    return;
  }
  const drivers = [...framework.supports, ...framework.pressures].slice(0, 5);
  els.frameworkPanel.innerHTML = `
    <div class="framework-summary">
      <div class="framework-score-row">
        <span class="pill ${framework.state}">${escapeHtml(framework.stateLabel)} ${formatScore(framework.score)}</span>
        <strong>${escapeHtml(framework.focus)}</strong>
      </div>
      <h3>${escapeHtml(framework.name)}</h3>
      <p>${escapeHtml(framework.summary)}</p>
      <p>${escapeHtml(framework.tactical)}</p>
    </div>
    <div class="framework-drivers">
      <h3>主要驱动</h3>
      <p>${escapeHtml(framework.useCase)}</p>
      <div class="driver-list">
        ${drivers.map(renderDriver).join("") || `<div class="driver"><span>暂无显著驱动。</span></div>`}
      </div>
    </div>
  `;
}

function renderDeleveragingFramework(framework) {
  const structure = framework.structure;
  const diagnosis = structure.diagnosis;
  const bottom = structure.bottom;
  const fragility = structure.fragility;
  const evidence = [
    ...diagnosis.mechanicalEvidence.map((item) => ({ ...item, type: "mechanical" })),
    ...diagnosis.fundamentalEvidence.map((item) => ({ ...item, type: "fundamental" }))
  ];
  return `
    <div class="structure-overview">
      <div class="structure-head">
        <div>
          <span class="pill ${framework.state}">${escapeHtml(framework.stateLabel)} ${formatScore(framework.score)}</span>
          <h3>${escapeHtml(framework.name)}</h3>
        </div>
        <div class="structure-stage ${bottom.blocked ? "blocked" : ""}">
          <span>触底阶段 ${escapeHtml(String(bottom.stage))}/4</span>
          <strong>${escapeHtml(bottom.label)}</strong>
        </div>
      </div>
      <p>${escapeHtml(diagnosis.summary)}</p>
      <p class="structure-action">${escapeHtml(bottom.action)}</p>
      <div class="structure-metrics">
        <div><span>下跌性质</span><strong>${escapeHtml(diagnosis.label)}</strong></div>
        <div><span>判断置信度</span><strong>${formatPercent(diagnosis.confidence * 100)}</strong></div>
        <div><span>市场脆弱度</span><strong>${escapeHtml(fragility.label)}</strong></div>
        <div><span>确认条件</span><strong>${bottom.metCount}/${bottom.totalCount}</strong></div>
      </div>
    </div>
    <div class="structure-details">
      <section>
        <h3>触底确认清单</h3>
        <div class="confirmation-list">
          ${bottom.confirmations.map((item) => `
            <div class="confirmation-row ${item.status !== "ok" ? "unavailable" : item.met ? "met" : "waiting"}">
              <span class="confirmation-mark">${item.status !== "ok" ? "?" : item.met ? "✓" : "·"}</span>
              <div>
                <strong>${escapeHtml(item.label)}</strong>
                <span>${escapeHtml(item.detail)}</span>
              </div>
              <small>${escapeHtml(item.status !== "ok" ? item.quality : item.met ? "已满足" : "等待确认")}</small>
            </div>
          `).join("")}
        </div>
      </section>
      <section>
        <h3>诊断证据与脆弱度</h3>
        <div class="evidence-list">
          ${evidence.map((item) => `
            <div class="evidence-row ${item.type}">
              <strong>${escapeHtml(item.label)}</strong>
              <span>${escapeHtml(item.detail)}</span>
            </div>
          `).join("") || `<div class="evidence-row"><span>当前没有足够的方向性证据。</span></div>`}
          ${fragility.items.map((item) => `
            <div class="evidence-row fragility">
              <strong>${escapeHtml(item.label)} · ${escapeHtml(item.value)}</strong>
              <span>${escapeHtml(item.detail)}</span>
            </div>
          `).join("")}
        </div>
        ${bottom.vetoes.length ? `
          <div class="veto-panel">
            <strong>当前否决条件</strong>
            ${bottom.vetoes.map((item) => `<span>${escapeHtml(item.label)}：${escapeHtml(item.detail)}</span>`).join("")}
          </div>
        ` : ""}
        <p class="quality-note">${escapeHtml(structure.dataQuality.note)}</p>
      </section>
    </div>
  `;
}

function renderDriver(driver) {
  return `
    <div class="driver">
      <strong>
        ${escapeHtml(driver.name)}
        <span class="pill ${driver.score >= 0 ? "supportive" : "pressure"}">${formatScore(driver.score)}</span>
      </strong>
      <span>${escapeHtml(driver.reading)}</span>
    </div>
  `;
}

function renderDimensions(dimensions) {
  els.dimensionList.innerHTML = dimensions
    .map((dimension) => {
      const width = Math.max(4, Math.round(((dimension.score + 1) / 2) * 100));
      const color = dimension.score > 0.25 ? "var(--green)" : dimension.score < -0.25 ? "var(--red)" : "var(--blue)";
      return `
        <div class="dimension">
          <div class="dimension-head">
            <span>${escapeHtml(dimension.name)}</span>
            <span class="pill ${dimension.state}">${escapeHtml(dimension.stateLabel)}</span>
          </div>
          <div class="bar"><span style="width:${width}%; background:${color}"></span></div>
          <div class="metric-label">覆盖 ${escapeHtml(dimension.coverage)} · 得分 ${formatScore(dimension.score)}</div>
        </div>
      `;
    })
    .join("");
}

function renderCategoryFilters(indicators) {
  const categories = ["全部", ...new Set(indicators.map((item) => item.category))];
  if (!categories.includes(state.selectedCategory)) state.selectedCategory = "全部";
  els.categoryFilters.innerHTML = categories
    .map(
      (category) => `
        <button type="button" class="${category === state.selectedCategory ? "active" : ""}" data-category="${escapeHtml(category)}">
          ${escapeHtml(category)}
        </button>
      `
    )
    .join("");
  els.categoryFilters.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedCategory = button.dataset.category;
      renderCategoryFilters(state.snapshot.indicators);
      renderIndicators(state.snapshot.indicators);
    });
  });
}

function renderIndicators(indicators) {
  const filtered = state.selectedCategory === "全部"
    ? indicators
    : indicators.filter((item) => item.category === state.selectedCategory);
  els.indicatorTable.innerHTML = filtered.map(renderIndicatorRow).join("");
  els.indicatorTable.querySelectorAll("[data-history]").forEach((container) => {
    const id = container.dataset.history;
    const item = filtered.find((indicator) => indicator.id === id);
    drawSparkline(container, item?.history || [], item?.state);
  });
}

function renderIndicatorRow(item) {
  const changeValue = item.changePct === null || item.changePct === undefined ? item.change : item.changePct;
  const changeClass = Number.isFinite(Number(changeValue))
    ? (Number(changeValue) >= 0 ? "up" : "down")
    : "";
  const changeText = item.changePct === null || item.changePct === undefined
    ? formatNumber(item.change)
    : `${formatNumber(item.changePct)}%`;
  const signalHtml = renderSignals(item.signals || []);
  return `
    <article class="indicator-row ${item.state}">
      <div class="indicator-name">
        <strong>${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(item.category)} · ${escapeHtml(item.source)} · ${escapeHtml(item.symbol || "")}</span>
      </div>
      <div>
        <span class="metric-label">最新</span>
        <strong class="metric-value">${formatValue(item.value, item.unit)}</strong>
      </div>
      <div>
        <span class="metric-label">短变动</span>
        <strong class="metric-value ${changeClass}">${changeText}</strong>
      </div>
      <div data-history="${escapeHtml(item.id)}"></div>
      <div class="reading">
        <span class="pill ${item.state}">${escapeHtml(item.stateLabel)}</span>
        ${escapeHtml(item.reading)}
        ${signalHtml}
      </div>
    </article>
  `;
}

function renderSignals(signals) {
  if (!signals.length) return "";
  return `
    <div class="signal-list">
      ${signals.map((signal) => `
        <span class="signal-chip ${escapeHtml(signal.direction)} ${escapeHtml(signal.severity)}" title="${escapeHtml(signal.detail)}">
          ${escapeHtml(signal.label)}
        </span>
      `).join("")}
    </div>
  `;
}

function drawSparkline(container, history, stateName) {
  if (!history.length) {
    container.innerHTML = `<span class="metric-label">暂无趋势</span>`;
    return;
  }
  const svg = els.sparklineTemplate.content.firstElementChild.cloneNode(true);
  const line = svg.querySelector("polyline");
  const values = history.map((item) => Number(item.value)).filter(Number.isFinite);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;
  const points = values.map((value, index) => {
    const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 120;
    const y = 31 - ((value - min) / spread) * 28;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  line.setAttribute("points", points.join(" "));
  if (stateName === "supportive") line.style.stroke = "var(--green)";
  if (stateName === "pressure") line.style.stroke = "var(--red)";
  container.replaceChildren(svg);
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatScore(value) {
  if (!Number.isFinite(Number(value))) return "--";
  return Number(value).toFixed(2);
}

function formatPercent(value) {
  if (!Number.isFinite(Number(value))) return "--";
  return `${Number(value).toFixed(0)}%`;
}

function formatNumber(value) {
  if (value === null || value === undefined || value === "") return "--";
  if (!Number.isFinite(Number(value))) return "--";
  return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function formatValue(value, unit) {
  if (value === null || value === undefined || value === "") return "不可用";
  if (!Number.isFinite(Number(value))) return "不可用";
  return `${Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ""}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function startLoadingProgress() {
  stopLoadingProgress(false);
  state.loadingIndex = 0;
  els.loadingOverlay.hidden = false;
  els.loadingSteps.innerHTML = loadingPlan.map((step, index) => `
    <span class="${index === 0 ? "active" : ""}">${escapeHtml(step)}</span>
  `).join("");
  updateLoadingProgress(0);
  state.loadingTimer = window.setInterval(() => {
    state.loadingIndex = Math.min(state.loadingIndex + 1, loadingPlan.length - 1);
    updateLoadingProgress(state.loadingIndex);
  }, 3600);
}

function updateLoadingProgress(index) {
  const cappedIndex = Math.min(index, loadingPlan.length - 1);
  const percent = Math.min(92, Math.round(((cappedIndex + 1) / loadingPlan.length) * 92));
  els.loadingPercent.textContent = `${percent}%`;
  els.loadingBar.style.width = `${percent}%`;
  els.loadingStep.textContent = loadingPlan[cappedIndex];
  els.loadingSteps.querySelectorAll("span").forEach((node, nodeIndex) => {
    node.className = nodeIndex < cappedIndex ? "done" : nodeIndex === cappedIndex ? "active" : "";
  });
}

function stopLoadingProgress(complete = true) {
  if (state.loadingTimer) {
    window.clearInterval(state.loadingTimer);
    state.loadingTimer = null;
  }
  if (!els.loadingOverlay) return;
  if (complete && !els.loadingOverlay.hidden) {
    els.loadingPercent.textContent = "100%";
    els.loadingBar.style.width = "100%";
    els.loadingStep.textContent = "更新完成";
    els.loadingSteps.querySelectorAll("span").forEach((node) => {
      node.className = "done";
    });
    window.setTimeout(() => {
      els.loadingOverlay.hidden = true;
    }, 450);
  } else if (!complete) {
    els.loadingOverlay.hidden = true;
  }
}
