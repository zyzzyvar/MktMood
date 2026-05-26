# 市场氛围综合看板

一个用于短期交易决策辅助的市场氛围 Dashboard。它把指标拆成两层：

- 指标层：美元指数、黄金、原油、VIX、股指、利率、中国资产等，每个指标都有趋势和直观解读。
- 框架层：同一组数据可以按“博主五信号”“宏观四象限”“流动性-风险偏好”“黑天鹅响应”“中国资产跨境框架”等版本做综合解读。

视频《美股一跌就慌，一涨又后悔》提到的 5 个信号已单独建成一个框架：

- VIX 恐慌指数
- CNN Fear & Greed Index
- 市场广度：等权/市值权重强弱、小盘/大盘强弱
- 信用市场：高收益债/投资级债强弱
- 美债/美元/黄金联动：10 年期美债收益率、美元指数、黄金

## 运行

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`。

默认监听 `HOST=0.0.0.0`、`PORT=3000`，也就是接受来自所有网卡的访问。如果部署在局域网或公网机器上，`.env` 中保持：

```bash
HOST=0.0.0.0
PORT=3000
```

PM2 启动或重启后可以用下面命令确认端口确实由 MktMood 监听：

```bash
pm2 restart mktmood --update-env
lsof -nP -iTCP:3000 -sTCP:LISTEN
curl "http://127.0.0.1:3000/api/health"
```

如果 `127.0.0.1` 可访问、外部地址不可访问，通常不是应用层限制，而是 macOS 防火墙、路由器端口转发、Nginx/反向代理或运营商入站策略需要放行 `3000/tcp`。

服务器更新建议统一使用仓库内的部署脚本：

```bash
cd /Users/zyzbot/MyProject/MktMood
bash deploy.sh
```

脚本会拉取代码、安装依赖、做语法检查、重建 PM2 进程、清理占用 3000 端口的旧进程，并验证健康检查、宏观解释库、异动个股画像和 Hermes 监控接口。

## Agent API

- `GET /api/snapshot`：完整市场快照、指标、维度、框架解读。
- `GET /api/frameworks`：只取框架和维度。
- `GET /api/events`：未来 7 天关键宏观数据和行业龙头财报提醒。
- `GET /api/agent/context?framework=liquidity-risk`：给 Agent 使用的紧凑上下文。

当前版本使用 Yahoo Finance 图表接口获取近实时行情，并尝试从 FRED 获取宏观序列。若某个公开数据源超时，接口会保留该指标并标记 `status: unavailable`。

## 指标事件信号

每个指标会输出 `signals`：

- `breakout`：最新一次变化显著超过该指标的固定阈值和近期常态波动，用来捕捉突然跳高/跳低。
- `persistence`：最近窗口内 80% 以上有效变化同向，且净变化也达到该指标阈值，用来捕捉连续单方向变化。

不同指标使用不同参数。例如 VIX、比特币、原油使用更宽的百分比阈值；美债收益率、CPI、失业率使用百分点阈值；非农使用千人级绝对变化；Fear & Greed 使用指数点数。

## 事件雷达

未来 7 天内的关键发布会进入 `upcomingEvents`：

- 美国宏观数据：从经济日历提取发布时间、前值、市场共识和预测，重点关注就业、通胀、GDP、消费、PMI/ISM、FOMC 等。
- 行业龙头财报：按行业维护观察名单，例如 AI/半导体、云、广告、消费、金融、能源、医疗、中国互联网等；使用财报日历里的 EPS 共识和分析师数量。
- 重点事件也会进入 Agent 上下文，方便后续交易 Agent 做“发布前提醒”和“发布后复盘”。

## PostgreSQL 落库

应用会读取 `.env` 中的 PostgreSQL 配置，并在 `mktmood` schema 下自动建表。当前写入内容包括：

- `mktmood.ingestion_runs`：每次采集批次和综合快照。
- `mktmood.indicator_observations`：每次刷新看到的指标值、得分和解读。
- `mktmood.indicator_history_points`：指标历史点位，按 `indicator_id + point_date` 去重更新。
- `mktmood.indicator_signals`：突破、持续单方向变化等信号。
- `mktmood.event_observations`：宏观数据和财报事件的每次观察值，用于追踪预测修正。

新增历史 API：

- `GET /api/history/indicators/:id`
- `GET /api/history/events/:key`
- `GET /api/signals`
- `GET /api/events/revisions`
- `GET /api/anomalies`
- `GET /api/hermes/monitor`

刷新流程会先读取数据库中已有 observation，再把“历史观察 + 本次当前值”一起用于判断：

- 指标信号：数据库 observation history 优先，用于识别我们自己持续观察到的突破和单向持续变化；外部数据源返回的历史序列作为补充。
- 事件修正：同一个 `event_key` 的本次 consensus/forecast/EPS forecast 会与上一次落库观察比较，用于识别发布前预测上修或下修。
- Agent 上下文：`databaseInsights.indicatorSignals` 和 `databaseInsights.eventRevisions` 会直接返回给 Agent。

## Hermes 监控接入

Hermes 可以每小时调用：

```bash
curl "http://127.0.0.1:3000/api/hermes/monitor?minSeverity=high"
```

返回字段：

- `shouldNotify`：是否有达到阈值的特别事项。
- `alerts`：结构化告警列表，包含类型、严重度、解释、关注方向。
- `dedupeKeys`：稳定去重键，Hermes 应保存已发送 key，避免重复 Telegram。
- `telegramText`：可直接发送到 Telegram 的纯文本摘要。

推荐逻辑：

1. 每小时请求 `/api/hermes/monitor?minSeverity=high`。
2. 若 `shouldNotify=true`，过滤掉 Hermes 已发送过的 `dedupeKeys`。
3. 仍有新 key 时，发送 `telegramText` 或按 `alerts` 自己组装消息。
4. 保存新 key，设置 1-3 天过期。

如果希望更敏感，可改成：

```bash
curl "http://127.0.0.1:3000/api/hermes/monitor?minSeverity=medium"
```

## 全市场异动雷达

看板会从全市场异动榜扫描显著上涨、显著下跌和高成交个股，再结合历史波动与成交量判断异常程度：

- 个股异动：识别单日大涨/大跌、相对自身常态波动倍数、成交量倍数。
- 龙头识别：不是只监控固定 watchlist，而是在扫出的异动个股里再识别传统行业龙头、超大市值龙头和大型行业代表。
- 板块异动：扫描行业和主题 ETF，展示异常上涨/下跌的行业板块。
- 落库：`mktmood.equity_anomaly_observations` 和 `mktmood.sector_move_observations` 会保存每轮扫描结果。
