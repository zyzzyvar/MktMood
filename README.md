# MktMood

MktMood 是一个面向短线决策和长期资产跟踪的市场氛围雷达。

它不是荐股工具，也不是一个只把行情堆在屏幕上的看板。它更像一个保持清醒的市场助手：把宏观、利率、美元、黄金、风险偏好、关键数据发布、财报、个股异动和行业异动放在同一张桌子上，然后告诉你现在值得紧张、值得等待，还是值得多看一眼。

适合这些场景：

- 你长期看好一些公司，希望在短期波动里做高抛低吸。
- 你想捕捉优质公司或传统龙头突然大跌时的“可能错杀”。
- 你想提前知道未来 7 天有哪些宏观数据、财报和市场共识值得关注。
- 你已经有自己的 Agent，希望它每小时读取市场上下文，并在有重要事项时提醒你。
- 你不想每天在一堆网站之间切换，只想先知道今天市场空气里有什么味道。

## V1.0 能做什么

### 综合市场氛围

MktMood 会抓取并解读一组影响股价和风险偏好的关键指标：

- 美股指数：标普 500、纳斯达克、罗素 2000
- 波动与情绪：VIX、CNN Fear & Greed
- 利率与美元：美国 2 年期/10 年期收益率、美元指数
- 商品与避险：黄金、原油、比特币
- 信用与宽度：高收益债/投资级债、等权指数/市值权重指数、小盘/大盘强弱
- 中国资产线索：人民币、港股、中概等相关观察项
- 宏观序列：就业、通胀、利率、消费者信心等公开数据

每个指标都有两层输出：

- 直接解读：这个指标现在偏支撑还是偏压力，为什么。
- 信号识别：是否出现突然跳高/跳低，是否出现连续单方向变化。

### 多套分析框架

同一组数据可以按不同思维框架重新解释。V1.0 内置：

- 博主五信号：VIX、Fear & Greed、市场宽度、信用市场、美债/美元/黄金联动。
- 宏观四象限：增长、通胀、利率和风险资产的组合关系。
- 流动性-风险偏好：美元、利率、信用、波动率共同判断资金环境。
- 黑天鹅响应：区分系统性冲击、行业冲击和个股事件。
- 中国资产跨境框架：观察人民币、港股、中概和全球风险偏好的联动。

### 未来 7 天关键发布

MktMood 会提前扫描即将公布的重要事项：

- 美国宏观数据：就业、通胀、GDP、PMI/ISM、消费者信心、FOMC 等。
- 市场共识：前值、预测值、共识值。
- 财报雷达：AI、半导体、云、广告、消费、金融、能源、医疗、中国互联网等行业代表公司的财报。

宏观事件不是只显示一个名字。比如 `CB Consumer Confidence`，看板会解释它是什么、为什么重要、高于/低于预期分别意味着什么，以及应重点观察哪些资产或行业反应。

### 全市场异动雷达

MktMood 不要求你维护 watchlist。它会先从全市场异动榜扫描，再识别异常背后的性质：

- 显著上涨/下跌的个股
- 相对自身历史波动的异常倍数
- 成交量放大倍数
- 是否属于传统行业龙头、超大市值龙头、行业代表公司或高波动个股
- 所属金融市场、交易所、行业、细分行业
- 一句话公司介绍，帮助你快速判断这是行业线索、题材线索，还是可能需要认真研究的基本面信号

示例输出会类似：

```text
FUTU：互联网券商/财富管理代表公司
市场：美国股票市场 / 纳斯达克全球市场
行业：金融
简介：富途是面向个人投资者的互联网券商和财富管理平台，波动常反映中概金融科技与交易活跃度预期。
```

板块维度也会扫描行业和主题 ETF，展示不寻常的行业波动。

### Agent 与 Telegram 接入

V1.0 已提供 Hermes/Agent 友好的接口：

- 返回结构化 alerts
- 返回稳定 dedupeKeys，方便去重
- 返回可直接发送到 Telegram 的 `telegramText`
- 支持按严重度过滤

你可以让自己的 Agent 每小时调用一次。当市场出现高优先级事项时，再把消息发给你。

页面顶部也内置了 `接入 Agent` 入口，会根据当前访问域名自动生成监控接口、Hermes/OpenClaw/通用 Agent 提示词、Cron 示例，并支持一键复制和接口测试。

## 快速开始

需要 Node.js 20+。

```bash
git clone https://github.com/zyzzyvar/MktMood.git
cd MktMood
npm install
npm run dev
```

打开：

```text
http://localhost:3000
```

默认监听：

```bash
HOST=0.0.0.0
PORT=3000
```

如果你只在本机使用，可以保持默认。若要给局域网、公网或 Agent 访问，请确认防火墙、路由器端口转发或反向代理已放行 `3000/tcp`。

## 环境变量

复制 `.env.example` 为 `.env`，按需填写。

```bash
HOST=0.0.0.0
PORT=3000

PGHOST=localhost
PGPORT=5432
PGDATABASE=mktmood
PGUSER=mktmood_user
PGPASSWORD=replace_me
PGSCHEMA=mktmood
PGSSL=false
YAHOO_BASE_URLS=https://query1.finance.yahoo.com,https://query2.finance.yahoo.com
FRED_TIMEOUT_MS=12000
CNN_TIMEOUT_MS=12000
FRED_FALLBACK_BASE_URLS=https://govspending.org/api/export/fred
FRED_SOURCE_ORDER=govspending,fred
```

PostgreSQL 不是强制依赖。没有数据库时，看板仍可运行；有数据库时，MktMood 会保存历史观察，用于识别突破、持续单方向变化、事件预测修正和异动记录。

## Mac/服务器部署

仓库内置 `deploy.sh`，建议后续统一用它更新服务。

第一次部署：

```bash
git clone https://github.com/zyzzyvar/MktMood.git
cd MktMood
cp .env.example .env
npm install
chmod +x deploy.sh
./deploy.sh
```

后续更新：

```bash
cd /path/to/MktMood
./deploy.sh
```

脚本会做这些事：

- `git pull --ff-only`
- 安装依赖
- 检查 JS 语法
- 删除旧 PM2 进程
- 清理占用 3000 端口的旧进程
- 用 PM2 重新启动
- 验证端口归属
- 验证前端、健康检查、宏观解释库、异动画像和 Hermes 接口

常用检查：

```bash
pm2 status mktmood
pm2 logs mktmood --lines 100
curl "http://127.0.0.1:3000/api/health"
```

## API

### Market Snapshot

```http
GET /api/snapshot
```

返回完整市场快照，包括指标、信号、框架解读、事件雷达、异动雷达和数据库洞察。

### Frameworks

```http
GET /api/frameworks
```

只返回分析框架和维度，适合轻量展示。

### Events

```http
GET /api/events
GET /api/events/revisions
```

返回未来 7 天宏观数据和财报事件，以及市场预测值的修正记录。

### Anomalies

```http
GET /api/anomalies
```

返回全市场个股异动、传统龙头异动和行业/板块异动。

### History And Signals

```http
GET /api/history/indicators/:id
GET /api/history/events/:key
GET /api/signals
```

返回数据库中的历史指标、事件观察和信号记录。

### Agent Context

```http
GET /api/agent/context?framework=liquidity-risk
```

返回适合 Agent 消化的紧凑上下文。

### Hermes Monitor

```http
GET /api/hermes/monitor?minSeverity=high&limit=10
```

返回字段包括：

- `shouldNotify`：是否需要提醒。
- `alerts`：结构化告警列表。
- `dedupeKeys`：去重键。
- `telegramText`：可直接发送到 Telegram 的文本。
- `nextSuggestedCheckMinutes`：建议下次检查间隔。

如果希望更敏感：

```bash
curl "http://127.0.0.1:3000/api/hermes/monitor?minSeverity=medium&limit=10"
```

推荐 Agent 逻辑：

1. 每小时请求 Hermes Monitor。
2. 如果 `shouldNotify=false`，不发送消息。
3. 如果 `shouldNotify=true`，用 `dedupeKeys` 过滤已发送事项。
4. 仍有新事项时，发送 `telegramText` 或按 `alerts` 自己组装。
5. 保存 dedupe key，设置 1-3 天过期。

## 数据落库

启用 PostgreSQL 后，MktMood 会在 `mktmood` schema 下自动建表和升级字段。

核心表：

- `mktmood.ingestion_runs`：每次采集批次和综合快照。
- `mktmood.indicator_observations`：每次刷新看到的指标值、得分和解释。
- `mktmood.indicator_history_points`：指标历史点位。
- `mktmood.indicator_signals`：突破、持续单方向变化等信号。
- `mktmood.event_observations`：宏观和财报事件观察，用于追踪预测修正。
- `mktmood.equity_anomaly_observations`：个股异动记录。
- `mktmood.sector_move_observations`：行业和板块异动记录。

数据库带来的价值不是“存一下而已”，而是让看板拥有记忆：

- 哪些指标不是一天跳动，而是连续几天单方向变化。
- 哪些经济数据的市场预期在发布前被上修或下修。
- 哪些行业或个股的异常波动值得复盘。

## 数据源

V1.0 使用公开数据源组合：

- Yahoo Finance：行情、图表、个股异动、行业 ETF。
- FRED：宏观时间序列。
- CNN Fear & Greed：风险偏好。
- Trading Economics：经济日历。
- Nasdaq：财报日历和 EPS 共识。

公开数据源偶尔会超时或变更页面结构。MktMood 会尽量降级处理，保留可用部分，并在接口中标记 source status。

如果服务器到 Yahoo Finance 的 TLS 握手失败，例如出现 `SSL_ERROR_SYSCALL`，通常是服务器网络、DNS、出口策略或代理问题。可以先在服务器上检查：

```bash
curl -I "https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=6mo&interval=1d"
curl -I "https://query2.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=6mo&interval=1d"
```

默认会依次尝试 `query1` 和 `query2`。如需接入自己的代理或镜像，可在 `.env` 中设置：

```bash
YAHOO_BASE_URLS=https://your-yahoo-proxy.example.com,https://query2.finance.yahoo.com
```

CNN Fear & Greed 会使用浏览器请求头访问 CNN 的 dataviz 接口；FRED 默认优先使用 Govspending 的 FRED 导出 JSON，再回退到官方 FRED CSV。这样能避开部分服务器访问 FRED 很慢的问题。服务器网络较慢时可以调大：

```bash
FRED_TIMEOUT_MS=20000
CNN_TIMEOUT_MS=15000
```

如果你希望优先使用官方 FRED 直连，可以设置：

```bash
FRED_SOURCE_ORDER=fred,govspending
```

## 设计原则

- 先看全市场，再识别重点，不要求用户维护固定名单。
- 每个指标都要能解释“是什么、为什么重要、接下来该关注什么”。
- 标准解释优先，暂不依赖 LLM，避免成本和不可控输出。
- 面向人阅读，也面向 Agent 调用。
- 做交易辅助，不替代仓位纪律、估值判断和基本面研究。

## 免责声明

MktMood 只提供市场信息整理、指标解释和风险线索，不构成投资建议。任何交易决策都应结合你的资金计划、风险承受能力、持仓结构和独立研究。

## 版本

当前稳定版：`v1.0`

这一版已经具备完整看板、数据库记忆、宏观/财报事件雷达、全市场异动雷达、Hermes/Agent 接口和服务器部署脚本。欢迎 fork、部署、改造，也欢迎把它接入你自己的交易助手。
