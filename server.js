const express = require("express");
const path = require("path");
const {
  initDb,
  persistSnapshot,
  getDbStatus,
  getIndicatorObservationHistory,
  getIndicatorHistoryPoints,
  getIndicatorObservationSeriesForIds,
  getEventObservationHistory,
  getEventObservationRowsForKeys,
  getRecentSignals,
  eventKey
} = require("./db");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const CACHE_MS = 60 * 1000;
const YAHOO_TIMEOUT_MS = 9000;
const FRED_TIMEOUT_MS = 5500;
const EVENT_LOOKAHEAD_DAYS = 7;

let snapshotCache = null;
let snapshotPromise = null;

const yahooIndicators = [
  {
    id: "spx",
    name: "标普 500",
    symbol: "^GSPC",
    category: "全球风险资产",
    unit: "点",
    sensitivity: 1,
    why: "美国大盘权益资产的核心温度计，反映盈利预期、流动性和风险偏好的合力。",
    high: "指数走强通常意味着风险偏好改善，适合观察强势股是否进入高抛区。",
    low: "指数走弱会压低短线胜率，优质股下跌需区分系统性回撤和个股基本面变化。"
  },
  {
    id: "nasdaq",
    name: "纳斯达克综合",
    symbol: "^IXIC",
    category: "成长与科技",
    unit: "点",
    sensitivity: 1,
    why: "成长股和科技权重更高，对利率、AI 资本开支和估值扩张更敏感。",
    high: "科技风险偏好偏暖，长期看好的成长股更容易被资金追逐。",
    low: "成长股估值承压，短线低吸要更重视仓位和确认信号。"
  },
  {
    id: "rut",
    name: "罗素 2000",
    symbol: "^RUT",
    category: "市场宽度",
    unit: "点",
    sensitivity: 1,
    why: "小盘股能帮助判断上涨是否从少数龙头扩散到更广泛市场。",
    high: "小盘同步走强时，市场宽度改善，短线情绪更健康。",
    low: "小盘弱于大盘常提示行情集中，追高胜率下降。"
  },
  {
    id: "vix",
    name: "VIX 恐慌指数",
    symbol: "^VIX",
    category: "波动与风险",
    unit: "",
    sensitivity: -1,
    levels: { hot: 25, cold: 15 },
    why: "衡量标普期权隐含波动率，是短线避险和强制减仓压力的近似指标。",
    high: "VIX 高企代表市场正在给风险重新定价，优质资产可能出现错杀窗口。",
    low: "VIX 回落代表恐慌溢价下降，但若降到极低区间也要警惕拥挤交易和保护不足。"
  },
  {
    id: "dxy",
    name: "美元指数",
    symbol: "DX-Y.NYB",
    category: "美元与流动性",
    unit: "",
    sensitivity: -1,
    why: "美元走强通常收紧全球美元流动性，并压制非美资产和大宗商品风险偏好。",
    high: "美元上行会让全球权益估值更挑剔，尤其压制外资敏感资产。",
    low: "美元走弱有利全球流动性扩散，风险资产更容易获得估值支撑。"
  },
  {
    id: "gold",
    name: "黄金期货",
    symbol: "GC=F",
    category: "通胀与避险",
    unit: "美元/盎司",
    sensitivity: -0.2,
    why: "黄金同时反映实际利率、美元信用、央行买盘和避险需求。",
    high: "黄金快速上行可能是降息预期、美元信用担忧或避险升温，需要结合美元和利率判断。",
    low: "黄金走弱通常说明实际利率或美元压制增强，避险需求下降。"
  },
  {
    id: "oil",
    name: "WTI 原油",
    symbol: "CL=F",
    category: "通胀与供给",
    unit: "美元/桶",
    sensitivity: -0.35,
    why: "油价会影响通胀预期、企业成本和地缘风险溢价。",
    high: "油价快速上涨可能推升通胀压力，让降息交易变脆。",
    low: "油价下行缓解通胀，但若来自需求走弱，也会伤害周期股预期。"
  },
  {
    id: "btc",
    name: "比特币",
    symbol: "BTC-USD",
    category: "高贝塔流动性",
    unit: "美元",
    sensitivity: 0.45,
    why: "比特币对全球流动性、杠杆情绪和高贝塔风险偏好较敏感。",
    high: "比特币走强常提示高风险资产资金活跃，可辅助判断情绪弹性。",
    low: "比特币走弱可能提示杠杆收缩或风险偏好降温。"
  },
  {
    id: "tnx",
    name: "美国 10 年期收益率",
    symbol: "^TNX",
    category: "利率与估值",
    unit: "%",
    sensitivity: -1,
    why: "长端利率是权益估值折现率的重要锚，尤其影响成长股估值。",
    high: "长端利率上行会压缩估值倍数，科技和长久期资产更敏感。",
    low: "长端利率下行有利估值扩张，但若来自衰退交易则需谨慎。"
  },
  {
    id: "irx",
    name: "美国 13 周国债收益率",
    symbol: "^IRX",
    category: "利率与现金回报",
    unit: "%",
    sensitivity: -0.6,
    why: "短端利率代表现金和货币基金的吸引力，也体现政策利率约束。",
    high: "短端利率高时，资金更愿意停在现金端，权益估值需要更强盈利来支撑。",
    low: "短端利率回落通常释放风险资产估值压力。"
  },
  {
    id: "shanghai",
    name: "上证指数",
    symbol: "000001.SS",
    category: "中国资产",
    unit: "点",
    sensitivity: 1,
    why: "A 股大盘情绪指标，受国内政策、人民币、地产信用和外资风险偏好影响。",
    high: "上证走强说明本土风险偏好改善，可观察顺周期和核心资产修复。",
    low: "上证走弱时，个股低吸要更多依赖基本面和政策催化。"
  },
  {
    id: "hsi",
    name: "恒生指数",
    symbol: "^HSI",
    category: "中国资产",
    unit: "点",
    sensitivity: 1,
    why: "港股对美元利率、外资风险偏好和中国增长预期更敏感。",
    high: "港股弹性改善常说明外资风险偏好和中国资产预期同步转暖。",
    low: "港股下行会压制中概、互联网和外资定价资产。"
  },
  {
    id: "cnh",
    name: "美元/人民币",
    symbol: "CNY=X",
    category: "汇率与外资",
    unit: "USDCNY",
    sensitivity: -0.65,
    why: "USDCNY 上行代表人民币走弱，常影响外资配置和中国资产风险溢价。",
    high: "人民币贬值压力上升时，外资敏感资产通常更难获得估值扩张。",
    low: "人民币走强有利中国资产风险溢价回落。"
  },
  {
    id: "kweb",
    name: "中国互联网 ETF",
    symbol: "KWEB",
    category: "中国资产",
    unit: "美元",
    sensitivity: 1,
    why: "中概互联网的交易温度计，集中反映政策、消费、美元利率和全球资金偏好。",
    high: "KWEB 走强代表中概成长风险偏好修复。",
    low: "KWEB 走弱提示外资对中国成长资产仍偏谨慎。"
  }
];

const fredIndicators = [
  {
    id: "fed_funds",
    name: "有效联邦基金利率",
    series: "DFF",
    category: "美联储政策",
    unit: "%",
    sensitivity: -1,
    transform: "latest",
    why: "最直接的美元政策利率温度计，决定现金收益率和风险资产折现率。",
    high: "高利率环境会提高持有现金的吸引力，权益估值更依赖盈利兑现。",
    low: "政策利率下行通常改善流动性预期，但要确认是否伴随增长恶化。"
  },
  {
    id: "payrolls",
    name: "非农就业月增",
    series: "PAYEMS",
    category: "就业与增长",
    unit: "千人",
    sensitivity: 0.25,
    transform: "monthlyChange",
    why: "非农就业影响增长预期、工资通胀和美联储政策路径。",
    high: "就业过热会支撑增长，但也可能推迟降息。",
    low: "就业明显走弱可能触发降息预期，同时提高衰退风险。"
  },
  {
    id: "unemployment",
    name: "美国失业率",
    series: "UNRATE",
    category: "就业与增长",
    unit: "%",
    sensitivity: -0.45,
    transform: "latest",
    why: "失业率是经济周期和政策反应函数的核心变量。",
    high: "失业率上升会抬高衰退概率，盈利预期承压。",
    low: "失业率低说明经济仍有韧性，但过紧也可能让美联储维持鹰派。"
  },
  {
    id: "cpi_yoy",
    name: "美国 CPI 同比",
    series: "CPIAUCSL",
    category: "通胀",
    unit: "%",
    sensitivity: -0.75,
    transform: "yoy",
    why: "通胀决定降息空间、实际利率和估值容忍度。",
    high: "通胀偏高会压制降息预期，利率敏感资产承压。",
    low: "通胀回落有利政策转松和估值修复。"
  },
  {
    id: "fed_balance",
    name: "美联储资产负债表",
    series: "WALCL",
    category: "美元与流动性",
    unit: "百万美元",
    sensitivity: 0.55,
    transform: "latest",
    why: "美联储资产负债表是美元系统流动性的关键背景变量。",
    high: "资产负债表扩张或停止收缩时，流动性环境通常改善。",
    low: "持续缩表会抽走系统流动性，提高风险资产波动。"
  }
];

const ratioIndicators = [
  {
    id: "rsp_spy",
    name: "等权/市值权重强弱",
    numerator: "RSP",
    denominator: "SPY",
    category: "市场广度",
    unit: "RSP/SPY",
    sensitivity: 1,
    why: "等权标普跑赢市值权重标普，通常说明上涨不只靠少数大市值龙头，市场广度更健康。",
    high: "等权指数相对走强，代表行情扩散，短线回踩更容易被承接。",
    low: "等权指数相对走弱，代表行情集中在少数权重，追高胜率下降。"
  },
  {
    id: "iwm_spy",
    name: "小盘/大盘强弱",
    numerator: "IWM",
    denominator: "SPY",
    category: "市场广度",
    unit: "IWM/SPY",
    sensitivity: 1,
    why: "小盘股相对大盘走强时，资金风险偏好和市场宽度通常更好。",
    high: "小盘相对强势，说明资金愿意扩散到更高贝塔资产。",
    low: "小盘相对弱势，说明风险偏好偏窄，市场更依赖权重股。"
  },
  {
    id: "hyg_lqd",
    name: "高收益债/投资级债强弱",
    numerator: "HYG",
    denominator: "LQD",
    category: "信用市场",
    unit: "HYG/LQD",
    sensitivity: 1,
    why: "高收益债相对投资级债走强，通常说明信用风险溢价下降，风险偏好改善。",
    high: "信用市场愿意承担风险，权益资产的系统性压力较低。",
    low: "高收益债相对走弱，可能提示信用压力上升，权益低吸需更谨慎。"
  }
];

const frameworkVersions = [
  {
    id: "creator-five-signals",
    name: "博主五信号",
    focus: "VIX、恐惧贪婪、市场广度、信用市场、美债/美元/黄金联动",
    useCase: "还原视频里用 5 个市场信号判断美股该加仓还是减仓的仪表盘思路。",
    includeIds: ["vix", "fear_greed", "rsp_spy", "iwm_spy", "hyg_lqd", "tnx", "dxy", "gold"],
    weights: {
      "波动与风险": 0.2,
      "情绪总表": 0.2,
      "市场广度": 0.22,
      "信用市场": 0.18,
      "美元与流动性": 0.07,
      "利率与估值": 0.07,
      "通胀与避险": 0.06
    }
  },
  {
    id: "macro-four-quadrants",
    name: "宏观四象限",
    focus: "增长、通胀、政策、风险偏好",
    useCase: "判断当下适合追随趋势、低吸错杀，还是降低仓位等待。",
    weights: {
      "全球风险资产": 0.2,
      "成长与科技": 0.14,
      "市场宽度": 0.12,
      "波动与风险": 0.16,
      "利率与估值": 0.12,
      "通胀": 0.1,
      "就业与增长": 0.08,
      "美联储政策": 0.08
    }
  },
  {
    id: "liquidity-risk",
    name: "流动性-风险偏好",
    focus: "美元、利率、波动率、高贝塔资产",
    useCase: "服务短线高抛低吸，识别风险资产是被流动性推着走，还是被风险事件压着走。",
    weights: {
      "美元与流动性": 0.22,
      "利率与估值": 0.2,
      "波动与风险": 0.18,
      "高贝塔流动性": 0.14,
      "全球风险资产": 0.14,
      "成长与科技": 0.12
    }
  },
  {
    id: "black-swan-response",
    name: "黑天鹅响应",
    focus: "波动率、美元、黄金、油价、汇率、指数同步性",
    useCase: "优质股突发下跌时，区分系统性冲击、行业冲击和个股冲击。",
    weights: {
      "波动与风险": 0.26,
      "美元与流动性": 0.18,
      "通胀与避险": 0.16,
      "通胀与供给": 0.12,
      "汇率与外资": 0.1,
      "全球风险资产": 0.1,
      "中国资产": 0.08
    }
  },
  {
    id: "china-cross-border",
    name: "中国资产跨境框架",
    focus: "A 股、港股、中概、人民币、美元利率",
    useCase: "用于判断中国优质资产的外资定价压力和本土政策修复弹性。",
    weights: {
      "中国资产": 0.36,
      "汇率与外资": 0.18,
      "美元与流动性": 0.16,
      "利率与估值": 0.12,
      "全球风险资产": 0.1,
      "波动与风险": 0.08
    }
  }
];

const macroEventRules = [
  { keyword: "non farm", theme: "就业", priority: "high", why: "非农决定增长韧性、工资通胀和美联储路径。" },
  { keyword: "unemployment", theme: "就业", priority: "high", why: "失业率是衰退风险和政策转向的重要信号。" },
  { keyword: "average hourly", theme: "工资通胀", priority: "high", why: "工资增速会影响服务通胀和降息空间。" },
  { keyword: "cpi", theme: "通胀", priority: "high", why: "CPI 是利率预期和估值折现率的核心驱动。" },
  { keyword: "pce", theme: "通胀", priority: "high", why: "PCE 是美联储更关注的通胀口径。" },
  { keyword: "fed interest rate", theme: "美联储", priority: "high", why: "政策利率会直接影响美元流动性和风险资产估值。" },
  { keyword: "fomc", theme: "美联储", priority: "high", why: "FOMC 纪要和决议会改变市场对利率路径的定价。" },
  { keyword: "gdp", theme: "增长", priority: "high", why: "GDP 影响盈利周期和软着陆/衰退判断。" },
  { keyword: "retail sales", theme: "消费", priority: "high", why: "零售销售是美国消费动能的高频确认。" },
  { keyword: "ism", theme: "企业景气", priority: "high", why: "ISM 对周期、订单和利润率预期敏感。" },
  { keyword: "pmi", theme: "企业景气", priority: "medium", why: "PMI 是增长动能的领先观察项。" },
  { keyword: "consumer confidence", theme: "消费情绪", priority: "medium", why: "消费者信心影响消费股和宏观增长预期。" },
  { keyword: "michigan", theme: "消费情绪", priority: "medium", why: "密歇根消费者调查包含信心和通胀预期。" },
  { keyword: "durable goods", theme: "投资需求", priority: "medium", why: "耐用品订单反映企业投资和制造需求。" },
  { keyword: "jobless claims", theme: "就业", priority: "medium", why: "初请失业金是劳动力市场降温的高频信号。" },
  { keyword: "jolts", theme: "就业", priority: "medium", why: "职位空缺帮助判断劳动力供需是否再平衡。" },
  { keyword: "industrial production", theme: "工业周期", priority: "medium", why: "工业产出影响周期股和需求判断。" },
  { keyword: "new home sales", theme: "地产", priority: "medium", why: "新屋销售影响地产链、利率敏感资产和消费耐用品。" }
];

const earningsWatchlist = {
  NVDA: { sector: "AI/加速计算", why: "AI 训练和推理需求、数据中心资本开支的核心温度计。" },
  AMD: { sector: "AI/半导体", why: "AI GPU 追赶、服务器 CPU 和 PC 周期的观察项。" },
  AVGO: { sector: "AI/网络与ASIC", why: "AI 网络、定制芯片和企业软件需求的混合信号。" },
  MRVL: { sector: "AI/网络与定制芯片", why: "AI 数据中心互联、定制芯片和光通信需求观察项。" },
  TSM: { sector: "半导体代工", why: "先进制程、AI 芯片订单和全球半导体周期的核心信号。" },
  ASML: { sector: "半导体设备", why: "EUV 设备订单反映先进制程扩产强度。" },
  AMAT: { sector: "半导体设备", why: "晶圆厂资本开支和设备周期指标。" },
  MSFT: { sector: "云/AI平台", why: "Azure、Copilot 和企业 AI 变现的关键样本。" },
  GOOGL: { sector: "广告/云/AI", why: "搜索广告、YouTube、云和 AI 投资回报的综合样本。" },
  AMZN: { sector: "云/消费", why: "AWS、线上消费和利润率改善的核心样本。" },
  META: { sector: "广告/AI应用", why: "数字广告景气、AI 推荐效率和资本开支预期。" },
  ORCL: { sector: "云基础设施", why: "AI 云合同、数据库迁移和企业 IT 支出的样本。" },
  CRM: { sector: "企业软件", why: "企业 SaaS 预算和 AI 软件商业化观察项。" },
  SNOW: { sector: "数据云", why: "数据平台消费、AI 数据基础设施需求样本。" },
  AAPL: { sector: "消费电子", why: "硬件需求、服务收入和高端消费韧性。" },
  DELL: { sector: "AI服务器/企业硬件", why: "AI 服务器订单、企业硬件周期和利润率的关键样本。" },
  HPQ: { sector: "PC/企业硬件", why: "PC 更新周期、企业终端需求和硬件库存观察项。" },
  TSLA: { sector: "电动车/自动驾驶", why: "电动车需求、价格战、储能和自动驾驶叙事。" },
  COST: { sector: "必选消费/会员零售", why: "高质量消费韧性和客流强度。" },
  WMT: { sector: "必选消费/零售", why: "大众消费、食品通胀和库存周期观察项。" },
  KO: { sector: "必选消费", why: "全球消费、定价能力和防御性资产信号。" },
  PEP: { sector: "必选消费", why: "食品饮料定价、销量和新兴市场消费样本。" },
  MCD: { sector: "餐饮消费", why: "低中端消费压力和全球客流的观察项。" },
  SBUX: { sector: "可选消费/中国消费", why: "高频消费、门店客流和中国消费情绪。" },
  NKE: { sector: "可选消费/品牌", why: "全球运动消费和库存折扣周期。" },
  JPM: { sector: "银行/信用", why: "信贷质量、净息差和资本市场活动的核心样本。" },
  BAC: { sector: "银行/利率", why: "利率曲线、存款成本和信贷周期观察项。" },
  GS: { sector: "投行/资本市场", why: "IPO、并购和交易收入景气度。" },
  V: { sector: "支付/消费", why: "消费交易量、跨境支付和服务消费信号。" },
  MA: { sector: "支付/消费", why: "全球支付网络和跨境消费温度计。" },
  XOM: { sector: "能源", why: "油气价格、资本开支和能源现金流。" },
  CVX: { sector: "能源", why: "综合能源利润率和股东回报信号。" },
  SLB: { sector: "油服", why: "上游资本开支和全球钻探周期。" },
  LLY: { sector: "医药/减重药", why: "GLP-1 需求、产能和医疗成长股估值锚。" },
  UNH: { sector: "医保服务", why: "医保成本趋势和防御板块风险偏好。" },
  JNJ: { sector: "医疗/防御", why: "大盘防御型医疗需求和诉讼风险样本。" },
  PFE: { sector: "制药", why: "专利悬崖、新药管线和防御股修复观察项。" },
  BABA: { sector: "中国互联网/消费", why: "中国消费、电商竞争和云业务修复信号。" },
  PDD: { sector: "中国互联网/消费", why: "电商价格带、Temu 和中国消费分层样本。" },
  JD: { sector: "中国互联网/零售", why: "耐用品消费、物流和价格竞争观察项。" },
  BIDU: { sector: "中国AI/广告", why: "中国广告、AI 云和自动驾驶叙事样本。" }
};

const sectorEtfs = [
  { symbol: "XLK", name: "科技", group: "标普行业" },
  { symbol: "XLF", name: "金融", group: "标普行业" },
  { symbol: "XLE", name: "能源", group: "标普行业" },
  { symbol: "XLV", name: "医疗", group: "标普行业" },
  { symbol: "XLY", name: "可选消费", group: "标普行业" },
  { symbol: "XLP", name: "必选消费", group: "标普行业" },
  { symbol: "XLI", name: "工业", group: "标普行业" },
  { symbol: "XLB", name: "材料", group: "标普行业" },
  { symbol: "XLU", name: "公用事业", group: "标普行业" },
  { symbol: "XLRE", name: "房地产", group: "标普行业" },
  { symbol: "XLC", name: "通信服务", group: "标普行业" },
  { symbol: "SMH", name: "半导体", group: "主题行业" },
  { symbol: "IGV", name: "软件", group: "主题行业" },
  { symbol: "KBE", name: "银行", group: "主题行业" },
  { symbol: "KRE", name: "区域银行", group: "主题行业" },
  { symbol: "XRT", name: "零售", group: "主题行业" },
  { symbol: "IYT", name: "运输", group: "主题行业" },
  { symbol: "ITA", name: "航空防务", group: "主题行业" },
  { symbol: "IBB", name: "生物科技", group: "主题行业" },
  { symbol: "KWEB", name: "中国互联网", group: "中国资产" },
  { symbol: "MCHI", name: "中国股票", group: "中国资产" }
];

const traditionalLeaderTags = {
  IBM: "企业科技传统龙头",
  INTC: "半导体传统龙头",
  ORCL: "企业软件传统龙头",
  KO: "必选消费传统龙头",
  PEP: "必选消费传统龙头",
  MCD: "餐饮消费传统龙头",
  WMT: "零售传统龙头",
  PG: "日化消费传统龙头",
  JNJ: "医疗传统龙头",
  PFE: "制药传统龙头",
  JPM: "银行传统龙头",
  BAC: "银行传统龙头",
  XOM: "能源传统龙头",
  CVX: "能源传统龙头",
  F: "汽车传统龙头",
  GM: "汽车传统龙头",
  GE: "工业传统龙头",
  CAT: "工业传统龙头",
  MMM: "工业传统龙头",
  HD: "家装零售龙头",
  COST: "会员零售龙头",
  DELL: "企业硬件龙头",
  HPQ: "PC硬件传统龙头",
  CSCO: "网络设备传统龙头"
};

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, updatedAt: new Date().toISOString(), storage: getDbStatus() });
});

app.get("/api/snapshot", async (_req, res) => {
  const snapshot = await getSnapshot();
  res.json(snapshot);
});

app.get("/api/frameworks", async (_req, res) => {
  const snapshot = await getSnapshot();
  res.json({
    updatedAt: snapshot.updatedAt,
    frameworks: snapshot.frameworks,
    dimensions: snapshot.dimensions
  });
});

app.get("/api/events", async (_req, res) => {
  const snapshot = await getSnapshot();
  res.json({
    updatedAt: snapshot.updatedAt,
    upcomingEvents: snapshot.upcomingEvents,
    eventRevisions: snapshot.databaseInsights?.eventRevisions || []
  });
});

app.get("/api/events/revisions", async (_req, res) => {
  const snapshot = await getSnapshot();
  res.json({
    updatedAt: snapshot.updatedAt,
    storage: snapshot.storage,
    eventRevisions: snapshot.databaseInsights?.eventRevisions || []
  });
});

app.get("/api/anomalies", async (_req, res) => {
  const snapshot = await getSnapshot();
  res.json({
    updatedAt: snapshot.updatedAt,
    storage: snapshot.storage,
    anomalyRadar: snapshot.anomalyRadar
  });
});

app.get("/api/history/indicators/:id", async (req, res) => {
  const id = String(req.params.id);
  const limit = Number(req.query.limit || 200);
  const [observations, historyPoints] = await Promise.all([
    getIndicatorObservationHistory(id, limit),
    getIndicatorHistoryPoints(id, limit)
  ]);
  res.json({
    indicatorId: id,
    storage: getDbStatus(),
    observations,
    historyPoints
  });
});

app.get("/api/history/events/:key", async (req, res) => {
  const key = String(req.params.key);
  const limit = Number(req.query.limit || 100);
  res.json({
    eventKey: key,
    storage: getDbStatus(),
    observations: await getEventObservationHistory(key, limit)
  });
});

app.get("/api/signals", async (req, res) => {
  res.json({
    storage: getDbStatus(),
    signals: await getRecentSignals(Number(req.query.limit || 100))
  });
});

app.get("/api/agent/context", async (req, res) => {
  const snapshot = await getSnapshot();
  const frameworkId = String(req.query.framework || "liquidity-risk");
  const selected = snapshot.frameworks.find((item) => item.id === frameworkId) || snapshot.frameworks[0];
  res.json({
    updatedAt: snapshot.updatedAt,
    framework: selected,
    marketScore: snapshot.marketScore,
    regime: snapshot.regime,
    flags: snapshot.flags,
    topSupports: snapshot.indicators.filter((item) => item.state === "supportive").slice(0, 5),
    topPressures: snapshot.indicators.filter((item) => item.state === "pressure").slice(0, 5),
    signalAlerts: snapshot.indicators
      .flatMap((item) => (item.signals || []).map((signal) => ({
        indicatorId: item.id,
        indicatorName: item.name,
        category: item.category,
        ...signal
      })))
      .slice(0, 12),
    upcomingEvents: {
      highAttention: snapshot.upcomingEvents.highAttention.slice(0, 8),
      macro: snapshot.upcomingEvents.macro.slice(0, 8),
      earnings: snapshot.upcomingEvents.earnings.slice(0, 8)
    },
    databaseInsights: {
      indicatorSignals: (snapshot.databaseInsights?.indicatorSignals || []).slice(0, 12),
      eventRevisions: (snapshot.databaseInsights?.eventRevisions || []).slice(0, 12)
    },
    anomalyRadar: {
      equityAnomalies: (snapshot.anomalyRadar?.equityAnomalies || []).slice(0, 12),
      sectorMoves: (snapshot.anomalyRadar?.sectorMoves || []).slice(0, 8)
    },
    storage: snapshot.storage,
    staleOrMissing: snapshot.indicators
      .filter((item) => item.status !== "ok")
      .map((item) => ({ id: item.id, name: item.name, source: item.source, status: item.status, error: item.error })),
    disclaimer: "This is market context, not investment advice. Combine it with position sizing, portfolio rules, and security-level research."
  });
});

app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Market atmosphere dashboard running at http://localhost:${PORT}`);
  initDb().then((status) => {
    if (status.ok) console.log(`PostgreSQL storage ready in schema ${status.schema}`);
    else if (status.enabled) console.warn(`PostgreSQL storage unavailable: ${status.lastError}`);
  });
});

async function getSnapshot() {
  if (snapshotCache && Date.now() - snapshotCache.createdAt < CACHE_MS) {
    return snapshotCache.data;
  }
  if (snapshotPromise) return snapshotPromise;

  snapshotPromise = buildSnapshot().finally(() => {
    snapshotPromise = null;
  });
  return snapshotPromise;
}

async function buildSnapshot() {
  const [yahooData, fredData, ratioData, sentimentData] = await Promise.all([
    fetchYahooIndicators(),
    fetchFredIndicators(),
    fetchRatioIndicators(),
    fetchSentimentIndicators()
  ]);
  const indicators = [...yahooData, ...fredData, ...ratioData, ...sentimentData].sort((a, b) => {
    if (a.status !== b.status) return a.status === "ok" ? -1 : 1;
    return Math.abs(b.score || 0) - Math.abs(a.score || 0);
  });
  const upcomingEvents = await fetchUpcomingEvents();
  const anomalyRadar = await fetchAnomalyRadar();
  const databaseInsights = await buildDatabaseInsights(indicators, upcomingEvents);
  applyDatabaseSignals(indicators, databaseInsights.indicatorSignals);

  const dimensions = buildDimensions(indicators);
  const frameworks = frameworkVersions.map((framework) => synthesizeFramework(framework, indicators, dimensions));
  const marketScore = weightedAverage(indicators.filter((item) => item.status === "ok"), "score");
  const regime = classifyRegime(marketScore, indicators);
  const flags = buildFlags(indicators, marketScore, anomalyRadar);

  const data = {
    updatedAt: new Date().toISOString(),
    marketScore: round(marketScore, 2),
    regime,
    flags,
    upcomingEvents,
    anomalyRadar,
    databaseInsights,
    dimensions,
    indicators,
    frameworks,
    api: {
      snapshot: "/api/snapshot",
      frameworks: "/api/frameworks",
      events: "/api/events",
      anomalies: "/api/anomalies",
      eventRevisions: "/api/events/revisions",
      indicatorHistory: "/api/history/indicators/spx",
      eventHistory: "/api/history/events/{eventKey}",
      signals: "/api/signals",
      agentContext: "/api/agent/context?framework=liquidity-risk"
    }
  };

  data.storage = await persistSnapshot(data);
  snapshotCache = { createdAt: Date.now(), data };
  return data;
}

async function buildDatabaseInsights(indicators, upcomingEvents) {
  const insights = {
    indicatorSignals: [],
    eventRevisions: [],
    observationCoverage: {
      indicatorIds: 0,
      eventKeys: 0
    }
  };
  try {
    const liveIndicators = indicators.filter((item) => item.status === "ok" && Number.isFinite(Number(item.value)));
    const seriesById = await getIndicatorObservationSeriesForIds(liveIndicators.map((item) => item.id), 40);
    insights.observationCoverage.indicatorIds = seriesById.size;
    for (const indicator of liveIndicators) {
      const rows = seriesById.get(indicator.id) || [];
      const signals = analyzeDatabaseObservationSignals(indicator, rows);
      for (const signal of signals) {
        insights.indicatorSignals.push({
          indicatorId: indicator.id,
          indicatorName: indicator.name,
          category: indicator.category,
          ...signal
        });
      }
    }

    const currentEvents = flattenUpcomingEvents(upcomingEvents);
    const keyToEvent = new Map(currentEvents.map((event) => [eventKey(event), event]));
    const eventRowsByKey = await getEventObservationRowsForKeys([...keyToEvent.keys()], 20);
    insights.observationCoverage.eventKeys = eventRowsByKey.size;
    for (const [key, event] of keyToEvent.entries()) {
      const revisions = detectEventRevisions(key, event, eventRowsByKey.get(key) || []);
      if (revisions.length) {
        event.revisions = revisions;
        insights.eventRevisions.push(...revisions);
      }
    }
  } catch (error) {
    insights.error = error.message;
  }
  insights.indicatorSignals.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  insights.eventRevisions.sort((a, b) => a.daysUntil - b.daysUntil || severityRank(a.severity) - severityRank(b.severity));
  return insights;
}

function analyzeDatabaseObservationSignals(indicator, rows) {
  const profile = signalProfile({ id: indicator.id });
  const points = rows
    .map((row) => ({
      date: new Date(row.observed_at).toISOString(),
      value: Number(row.value)
    }))
    .filter((point) => Number.isFinite(point.value));
  points.push({ date: new Date().toISOString(), value: Number(indicator.value) });
  const unique = collapseNearDuplicatePoints(points);
  if (unique.length < 4) return [];
  return analyzeSignals({ id: indicator.id }, unique).map((signal) => ({
    ...signal,
    source: "database",
    label: signal.type === "breakout"
      ? `观察${signal.direction === "up" ? "跳高" : "跳低"}`
      : `观察${signal.direction === "up" ? "持续上行" : "持续下行"}`,
    detail: `基于本地落库观察：${signal.detail}`
  }));
}

function collapseNearDuplicatePoints(points) {
  const collapsed = [];
  for (const point of points) {
    const last = collapsed.at(-1);
    if (last && last.date === point.date && last.value === point.value) continue;
    collapsed.push(point);
  }
  return collapsed;
}

function applyDatabaseSignals(indicators, databaseSignals) {
  const byId = new Map(indicators.map((item) => [item.id, item]));
  for (const signal of databaseSignals) {
    const indicator = byId.get(signal.indicatorId);
    if (!indicator) continue;
    const exists = (indicator.signals || []).some((item) => (
      item.source === "database" && item.type === signal.type && item.direction === signal.direction
    ));
    if (!exists) {
      indicator.signals = [stripIndicatorSignal(signal), ...(indicator.signals || [])].slice(0, 4);
    }
  }
}

function stripIndicatorSignal(signal) {
  const { indicatorId, indicatorName, category, ...rest } = signal;
  return rest;
}

function flattenUpcomingEvents(upcomingEvents) {
  const events = [];
  const seen = new Set();
  for (const event of [...(upcomingEvents?.macro || []), ...(upcomingEvents?.earnings || [])]) {
    const key = eventKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    events.push(event);
  }
  return events.filter((event) => event.status === "ok");
}

function detectEventRevisions(key, currentEvent, priorRows) {
  if (!priorRows.length) return [];
  const latest = priorRows.at(-1);
  const fields = currentEvent.type === "earnings"
    ? [{ current: "epsForecast", previous: "eps_forecast", label: "EPS 共识" }]
    : [
        { current: "consensus", previous: "consensus", label: "共识" },
        { current: "forecast", previous: "forecast", label: "预测" },
        { current: "expectation", previous: "expectation", label: "综合预期" }
      ];
  const revisions = [];
  for (const field of fields) {
    const before = normalizeRevisionValue(latest[field.previous]);
    const after = normalizeRevisionValue(currentEvent[field.current]);
    if (!before || !after || before === after) continue;
    const beforeNumber = parseComparableNumber(before);
    const afterNumber = parseComparableNumber(after);
    const direction = Number.isFinite(beforeNumber) && Number.isFinite(afterNumber)
      ? (afterNumber > beforeNumber ? "up" : afterNumber < beforeNumber ? "down" : "changed")
      : "changed";
    if (direction === "changed" && before === after) continue;
    revisions.push({
      type: "event_revision",
      source: "database",
      eventKey: key,
      eventType: currentEvent.type,
      title: currentEvent.title,
      symbol: currentEvent.symbol || null,
      date: currentEvent.date,
      daysUntil: currentEvent.daysUntil,
      field: field.current,
      fieldLabel: field.label,
      before,
      after,
      direction,
      severity: currentEvent.priority === "high" ? "high" : "medium",
      detail: `${currentEvent.title} 的${field.label}从 ${before} 调整为 ${after}。`
    });
  }
  return revisions;
}

function normalizeRevisionValue(value) {
  const text = String(value || "").trim();
  if (!text || text === "暂无共识" || text === "暂无公开预测" || text === "EPS 共识暂缺") return "";
  return text.replace(/^EPS 共识\s*/i, "").trim();
}

function parseComparableNumber(value) {
  const text = String(value || "").trim();
  if (!text) return NaN;
  const negative = /^\(.+\)$/.test(text);
  const cleaned = text.replace(/[,$%()]/g, "").replace(/[^\d.-]/g, "");
  const number = Number(cleaned);
  if (!Number.isFinite(number)) return NaN;
  return negative ? -number : number;
}

function severityRank(severity) {
  return { high: 0, medium: 1, low: 2 }[severity] ?? 3;
}

async function fetchAnomalyRadar() {
  const [equityAnomalies, sectorMoves] = await Promise.all([
    fetchEquityAnomalies(),
    fetchSectorMoves()
  ]);
  const legacyLeaderAlerts = equityAnomalies.filter((item) => item.isTraditionalLeader);
  return {
    sourceStatus: {
      equities: equityAnomalies.some((item) => item.status === "unavailable") ? "partial" : "ok",
      sectors: sectorMoves.some((item) => item.status === "unavailable") ? "partial" : "ok"
    },
    equityAnomalies,
    sectorMoves,
    legacyLeaderAlerts,
    summary: buildAnomalySummary(equityAnomalies, sectorMoves)
  };
}

async function fetchEquityAnomalies() {
  try {
    const screenerIds = ["day_losers", "day_gainers", "most_actives"];
    const results = await Promise.all(screenerIds.map(fetchYahooScreener));
    const bySymbol = new Map();
    for (const quote of results.flat()) {
      const symbol = String(quote.symbol || "").trim().toUpperCase();
      if (!symbol || symbol.includes(".") || symbol.includes("-") || quote.quoteType === "ETF") continue;
      const existing = bySymbol.get(symbol);
      const changePct = Number(quote.regularMarketChangePercent);
      if (!existing || Math.abs(changePct) > Math.abs(Number(existing.regularMarketChangePercent) || 0)) {
        bySymbol.set(symbol, quote);
      }
    }
    const candidates = [...bySymbol.values()]
      .filter((quote) => {
        const changePct = Math.abs(Number(quote.regularMarketChangePercent) || 0);
        const marketCap = Number(quote.marketCap) || 0;
        return changePct >= 6 || (marketCap >= 50_000_000_000 && changePct >= 4);
      })
      .sort((a, b) => Math.abs(Number(b.regularMarketChangePercent) || 0) - Math.abs(Number(a.regularMarketChangePercent) || 0))
      .slice(0, 45);
    const enriched = await mapWithConcurrency(candidates, 6, enrichEquityAnomaly);
    return enriched
      .filter(Boolean)
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || Math.abs(b.changePct) - Math.abs(a.changePct))
      .slice(0, 30);
  } catch (error) {
    return [{
      status: "unavailable",
      symbol: "market",
      name: "全市场个股异动",
      anomalyType: "source_unavailable",
      severity: "medium",
      explanation: `个股异动源暂不可用：${error.message}`
    }];
  }
}

async function fetchYahooScreener(scrId) {
  const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${scrId}&count=100`;
  const json = await fetchJson(url, YAHOO_TIMEOUT_MS);
  return json.finance?.result?.[0]?.quotes || [];
}

async function enrichEquityAnomaly(quote) {
  const symbol = String(quote.symbol || "").toUpperCase();
  const changePct = Number(quote.regularMarketChangePercent) || 0;
  const chart = await fetchYahooChart(symbol).catch(() => null);
  const stats = chart ? computeChartStats(chart) : {};
  const absChange = Math.abs(changePct);
  const abnormalMoveRatio = stats.avgAbsChangePct ? absChange / stats.avgAbsChangePct : null;
  const volume = Number(quote.regularMarketVolume) || stats.latestVolume || null;
  const volumeRatio = stats.avgVolume ? volume / stats.avgVolume : null;
  const marketCap = Number(quote.marketCap) || null;
  const classification = classifyEquityAnomaly(symbol, quote.shortName || quote.longName || symbol, marketCap);
  const sectorLabel = inferSectorLabel(symbol, quote.shortName || "");
  const severity = absChange >= 10 || abnormalMoveRatio >= 3 || (classification.isTraditionalLeader && absChange >= 7)
    ? "high"
    : "medium";
  return {
    type: "equity_anomaly",
    status: "ok",
    symbol,
    name: quote.shortName || quote.longName || symbol,
    anomalyType: changePct < 0 ? "sharp_drop" : "sharp_rise",
    direction: changePct < 0 ? "down" : "up",
    severity,
    changePct: round(changePct, 2),
    marketCap,
    volume,
    volumeRatio: round(volumeRatio, 2),
    abnormalMoveRatio: round(abnormalMoveRatio, 2),
    classification: classification.label,
    isTraditionalLeader: classification.isTraditionalLeader,
    sectorLabel,
    explanation: buildEquityAnomalyExplanation(symbol, changePct, classification, sectorLabel, abnormalMoveRatio, volumeRatio),
    source: "Yahoo Finance screener"
  };
}

function computeChartStats(result) {
  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const closes = quote.close || [];
  const volumes = quote.volume || [];
  const changes = [];
  for (let index = 1; index < closes.length; index += 1) {
    if (Number.isFinite(closes[index]) && Number.isFinite(closes[index - 1]) && closes[index - 1] !== 0) {
      changes.push(Math.abs(pct(closes[index], closes[index - 1])));
    }
  }
  const recentChanges = changes.slice(-60);
  const recentVolumes = volumes.filter(Number.isFinite).slice(-60);
  return {
    points: timestamps.length,
    avgAbsChangePct: recentChanges.length ? recentChanges.reduce((sum, value) => sum + value, 0) / recentChanges.length : null,
    avgVolume: recentVolumes.length ? recentVolumes.reduce((sum, value) => sum + value, 0) / recentVolumes.length : null,
    latestVolume: recentVolumes.at(-1) || null
  };
}

function classifyEquityAnomaly(symbol, name, marketCap) {
  if (traditionalLeaderTags[symbol]) {
    return { label: traditionalLeaderTags[symbol], isTraditionalLeader: true };
  }
  if ((marketCap || 0) >= 200_000_000_000) return { label: "超大市值龙头", isTraditionalLeader: false };
  if ((marketCap || 0) >= 50_000_000_000) return { label: "大型行业代表", isTraditionalLeader: false };
  if (/holdings|systems|semiconductor|energy|bank|pharma|retail|software/i.test(name)) {
    return { label: "行业代表公司", isTraditionalLeader: false };
  }
  return { label: "高波动个股", isTraditionalLeader: false };
}

function inferSectorLabel(symbol, name) {
  const text = `${symbol} ${name}`.toLowerCase();
  if (/semiconductor|chip|nvidia|intel|amd|marvell|cerebras|navitas/.test(text)) return "半导体/AI硬件";
  if (/dell|hp inc|hewlett|pc|hardware/.test(text)) return "企业硬件/PC";
  if (/software|oracle|salesforce|snowflake|zscaler/.test(text)) return "企业软件";
  if (/bank|financial|capital|holdings/.test(text)) return "金融";
  if (/energy|oil|solar|fervo/.test(text)) return "能源";
  if (/coca|pepsi|food|retail|costco|walmart|mcdonald/.test(text)) return "消费";
  if (/pharma|bio|medical|health/.test(text)) return "医疗";
  if (/auto|motor|ford|tesla|gm/.test(text)) return "汽车";
  return "未分类";
}

function buildEquityAnomalyExplanation(symbol, changePct, classification, sectorLabel, abnormalMoveRatio, volumeRatio) {
  const move = changePct < 0 ? "大跌" : "大涨";
  const leader = classification.isTraditionalLeader
    ? (changePct < 0
      ? "，且属于传统行业龙头，需要区分系统性错杀、财报/指引重定价和基本面恶化"
      : "，且属于传统行业龙头，需要区分业绩/指引重定价、行业需求改善和短线挤仓")
    : "";
  const vol = abnormalMoveRatio ? `，约为自身常态日波动的 ${round(abnormalMoveRatio, 1)} 倍` : "";
  const volume = volumeRatio ? `，成交量约为近期均量 ${round(volumeRatio, 1)} 倍` : "";
  return `${symbol} 单日${move} ${Math.abs(round(changePct, 2))}%${vol}${volume}，归类为${classification.label}/${sectorLabel}${leader}。`;
}

async function fetchSectorMoves() {
  const moves = await mapWithConcurrency(sectorEtfs, 6, async (config) => {
    try {
      const result = await fetchYahooChart(config.symbol);
      const points = normalizeYahooPoints(result, { id: config.symbol, unit: "" });
      if (points.length < 2) return null;
      const current = points.at(-1).value;
      const previous = points.at(-2).value;
      const value20 = points.at(-21)?.value ?? points[0].value;
      const changePct = pct(current, previous);
      const trend20 = pct(current, value20);
      const stats = computeChartStats(result);
      const abnormalMoveRatio = stats.avgAbsChangePct ? Math.abs(changePct) / stats.avgAbsChangePct : null;
      if (Math.abs(changePct) < 2.2 && abnormalMoveRatio < 2.2) return null;
      const direction = changePct < 0 ? "down" : "up";
      return {
        type: "sector_move",
        status: "ok",
        symbol: config.symbol,
        name: config.name,
        group: config.group,
        direction,
        severity: Math.abs(changePct) >= 3.5 || abnormalMoveRatio >= 3 ? "high" : "medium",
        changePct: round(changePct, 2),
        trend20: round(trend20, 2),
        abnormalMoveRatio: round(abnormalMoveRatio, 2),
        explanation: `${config.name}板块 ETF ${config.symbol} 单日${direction === "down" ? "下跌" : "上涨"} ${Math.abs(round(changePct, 2))}%，约为自身常态波动 ${round(abnormalMoveRatio, 1)} 倍。`
      };
    } catch {
      return null;
    }
  });
  return moves.filter(Boolean).sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || Math.abs(b.changePct) - Math.abs(a.changePct));
}

function buildAnomalySummary(equityAnomalies, sectorMoves) {
  const leaders = equityAnomalies.filter((item) => item.isTraditionalLeader);
  const sharpDrops = equityAnomalies.filter((item) => item.direction === "down");
  const sharpRises = equityAnomalies.filter((item) => item.direction === "up");
  return {
    equityCount: equityAnomalies.filter((item) => item.status === "ok").length,
    sectorCount: sectorMoves.filter((item) => item.status === "ok").length,
    traditionalLeaderCount: leaders.length,
    text: `全市场异动扫描发现 ${sharpDrops.length} 个显著下跌、${sharpRises.length} 个显著上涨，传统/成熟龙头 ${leaders.length} 个，板块异常 ${sectorMoves.length} 个。`
  };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = [];
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      results.push(await worker(current));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

async function fetchUpcomingEvents() {
  const [macro, earnings] = await Promise.all([
    fetchMacroCalendarEvents(),
    fetchEarningsEvents()
  ]);
  const highAttention = [...macro, ...earnings]
    .filter((event) => event.priority === "high" || event.daysUntil <= 2)
    .sort((a, b) => a.daysUntil - b.daysUntil || priorityRank(a.priority) - priorityRank(b.priority))
    .slice(0, 12);
  const sourceStatus = {
    macro: macro.some((event) => event.status === "unavailable") ? "partial" : "ok",
    earnings: earnings.some((event) => event.status === "unavailable") ? "partial" : "ok"
  };
  return {
    windowDays: EVENT_LOOKAHEAD_DAYS,
    sourceStatus,
    highAttention,
    macro,
    earnings,
    sectorLeaders: Object.entries(earningsWatchlist).map(([symbol, meta]) => ({ symbol, ...meta }))
  };
}

async function fetchMacroCalendarEvents() {
  try {
    const today = dateOnly(new Date());
    const end = dateOnly(addDays(new Date(), EVENT_LOOKAHEAD_DAYS));
    const url = `https://tradingeconomics.com/united-states/calendar?importance=2&startdate=${today}&enddate=${end}`;
    const html = await fetchText(url, 12000);
    const events = parseTradingEconomicsCalendar(html)
      .filter((event) => event.daysUntil >= 0 && event.daysUntil <= EVENT_LOOKAHEAD_DAYS)
      .map(enrichMacroEvent)
      .filter(Boolean)
      .sort((a, b) => a.daysUntil - b.daysUntil || priorityRank(a.priority) - priorityRank(b.priority));
    return events.slice(0, 30);
  } catch (error) {
    return [unavailableEvent("macro", "美国经济日历", "Trading Economics", error)];
  }
}

async function fetchEarningsEvents() {
  try {
    const allRows = [];
    for (let offset = 0; offset <= EVENT_LOOKAHEAD_DAYS; offset += 1) {
      const date = dateOnly(addDays(new Date(), offset));
      const url = `https://api.nasdaq.com/api/calendar/earnings?date=${date}`;
      const json = await fetchJson(url, 10000, {
        Accept: "application/json, text/plain, */*",
        Origin: "https://www.nasdaq.com",
        Referer: "https://www.nasdaq.com/"
      });
      const rows = json.data?.rows || [];
      for (const row of rows) allRows.push({ date, row });
    }
    return allRows
      .map(({ date, row }) => buildEarningsEvent(date, row))
      .filter(Boolean)
      .sort((a, b) => a.daysUntil - b.daysUntil || priorityRank(a.priority) - priorityRank(b.priority))
      .slice(0, 40);
  } catch (error) {
    return [unavailableEvent("earnings", "关键公司财报日历", "Nasdaq", error)];
  }
}

function parseTradingEconomicsCalendar(html) {
  const events = [];
  const rowPattern = /<tr\s+data-url="([^"]+)"\s+data-id="([^"]+)"\s+data-country="([^"]*)"\s+data-category="([^"]*)"\s+data-event="([^"]*)"\s+data-symbol='([^']*)'[\s\S]*?(?=\n\s*<tr\s+data-url=|\n\s*<thead)/gi;
  let match;
  while ((match = rowPattern.exec(html))) {
    const rowHtml = match[0];
    const dateMatch = rowHtml.match(/<td[^>]*class='[^']*(\d{4}-\d{2}-\d{2})[^']*'[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i);
    const titleMatch = rowHtml.match(/<a class='calendar-event'[^>]*>([\s\S]*?)<\/a>/i);
    const referenceMatch = rowHtml.match(/<span class="calendar-reference">([\s\S]*?)<\/span>/i);
    const date = dateMatch?.[1];
    if (!date) continue;
    events.push({
      type: "macro",
      status: "ok",
      date,
      time: cleanHtml(dateMatch?.[2] || ""),
      daysUntil: daysUntil(date),
      title: prettifyEventTitle(cleanHtml(titleMatch?.[1] || htmlDecode(match[5]))),
      reference: cleanHtml(referenceMatch?.[1] || ""),
      category: htmlDecode(match[4]),
      symbol: htmlDecode(match[6]),
      source: "Trading Economics",
      previous: extractCalendarValue(rowHtml, "previous"),
      consensus: extractCalendarValue(rowHtml, "consensus"),
      forecast: extractCalendarValue(rowHtml, "forecast"),
      actual: extractCalendarValue(rowHtml, "actual"),
      url: `https://tradingeconomics.com${match[1]}`
    });
  }
  return events;
}

function enrichMacroEvent(event) {
  const haystack = `${event.title} ${event.category}`.toLowerCase();
  const rule = macroEventRules.find((candidate) => haystack.includes(candidate.keyword));
  if (!rule) return null;
  const expectation = event.consensus || event.forecast || "暂无公开预测";
  return {
    ...event,
    theme: rule.theme,
    priority: rule.priority,
    why: rule.why,
    expectation,
    watchText: `${event.title}${event.reference ? `（${event.reference}）` : ""}将在 ${event.daysUntil} 天内发布，市场共识/预测：${expectation}。`
  };
}

function buildEarningsEvent(date, row) {
  const symbol = String(row.symbol || "").trim().toUpperCase();
  if (!symbol) return null;
  const meta = earningsWatchlist[symbol];
  const marketCapValue = parseMarketCap(row.marketCap);
  if (!meta && marketCapValue < 150_000_000_000) return null;
  const priority = meta ? "high" : "medium";
  return {
    type: "earnings",
    status: "ok",
    date,
    time: earningsTimeLabel(row.time),
    daysUntil: daysUntil(date),
    symbol,
    title: `${symbol} ${row.name || ""}`.trim(),
    company: row.name || symbol,
    sector: meta?.sector || "大型公司",
    priority,
    source: "Nasdaq",
    epsForecast: row.epsForecast || "暂无共识",
    noOfEsts: row.noOfEsts || "N/A",
    lastYearEPS: row.lastYearEPS || "N/A",
    fiscalQuarterEnding: row.fiscalQuarterEnding || "",
    marketCap: row.marketCap || "",
    why: meta?.why || "超大市值公司财报可能影响指数权重、行业估值和风险偏好。",
    expectation: row.epsForecast ? `EPS 共识 ${row.epsForecast}` : "EPS 共识暂缺",
    watchText: `${symbol} 将在 ${date} ${earningsTimeLabel(row.time)} 发布财报，${row.epsForecast ? `EPS 共识 ${row.epsForecast}` : "EPS 共识暂缺"}，去年同期 ${row.lastYearEPS || "N/A"}。`
  };
}

function unavailableEvent(type, title, source, error) {
  return {
    type,
    status: "unavailable",
    date: dateOnly(new Date()),
    time: "",
    daysUntil: 0,
    title,
    source,
    priority: "medium",
    expectation: "预测源暂不可用",
    watchText: `${title}暂时无法获取：${error?.message || String(error)}`
  };
}

function extractCalendarValue(html, id) {
  const match = html.match(new RegExp(`id=['"]${id}['"][^>]*>([\\s\\S]*?)<\\/(?:span|a)>`, "i"));
  return cleanHtml(match?.[1] || "");
}

function cleanHtml(value) {
  return htmlDecode(String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function prettifyEventTitle(value) {
  const text = String(value || "").trim();
  if (!text || /[A-Z]/.test(text.slice(1))) return text;
  const keepUpper = new Set(["cpi", "pce", "gdp", "ism", "pmi", "fomc", "jolts", "cb"]);
  return text.split(/\s+/).map((word) => {
    const lower = word.toLowerCase();
    if (keepUpper.has(lower)) return lower.toUpperCase();
    if (lower === "mom" || lower === "yoy" || lower === "qoq") return lower.charAt(0).toUpperCase() + lower.slice(1);
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(" ");
}

function htmlDecode(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function parseMarketCap(value) {
  const raw = String(value || "").replace(/[$,]/g, "");
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function earningsTimeLabel(value) {
  const text = String(value || "");
  if (text.includes("pre")) return "盘前";
  if (text.includes("after")) return "盘后";
  return "时间未定";
}

function priorityRank(priority) {
  return { high: 0, medium: 1, low: 2 }[priority] ?? 3;
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function dateOnly(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysUntil(date) {
  const today = new Date(`${dateOnly(new Date())}T00:00:00`);
  const target = new Date(`${date}T00:00:00`);
  return Math.round((target - today) / 86400000);
}

async function fetchRatioIndicators() {
  const tasks = ratioIndicators.map(async (config) => {
    try {
      const [numeratorJson, denominatorJson] = await Promise.all([
        fetchYahooChart(config.numerator),
        fetchYahooChart(config.denominator)
      ]);
      const numerator = normalizeYahooPoints(numeratorJson, config);
      const denominator = normalizeYahooPoints(denominatorJson, config);
      const denominatorByDate = new Map(denominator.map((point) => [point.date, point.value]));
      const points = numerator
        .map((point) => {
          const base = denominatorByDate.get(point.date);
          if (!Number.isFinite(base) || base === 0) return null;
          return { date: point.date, value: (point.value / base) * 100 };
        })
        .filter(Boolean);
      if (points.length < 2) throw new Error("Not enough ratio history");
      return buildMarketIndicator(config, points, { regularMarketTime: Date.now() / 1000 });
    } catch (error) {
      return unavailableIndicator(config, "Yahoo Finance ratio", error);
    }
  });
  return Promise.all(tasks);
}

async function fetchSentimentIndicators() {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const url = `https://production.dataviz.cnn.io/index/fearandgreed/graphdata/${date}`;
    const json = await fetchJson(url, FRED_TIMEOUT_MS, {
      Accept: "application/json,text/plain,*/*",
      Referer: "https://www.cnn.com/markets/fear-and-greed"
    });
    const current = Number(json.fear_and_greed?.score);
    if (!Number.isFinite(current)) throw new Error("CNN Fear & Greed score missing");
    const history = (json.fear_and_greed_historical?.data || [])
      .map((point) => ({
        date: new Date(point.x).toISOString().slice(0, 10),
        value: Number(point.y)
      }))
      .filter((point) => Number.isFinite(point.value));
    const previous = Number(json.fear_and_greed?.previous_close ?? history.at(-2)?.value ?? current);
    const value20 = Number(json.fear_and_greed?.previous_1_month ?? history.at(-21)?.value ?? current);
    const value60 = Number(json.fear_and_greed?.previous_1_year ?? history.at(-61)?.value ?? current);
    const score = scoreFearGreed(current, value20);
    const state = scoreToState(score);
    const signalPoints = history.length ? history : [{ date, value: current }];
    const signals = analyzeSignals({ id: "fear_greed" }, signalPoints);
    return [{
      id: "fear_greed",
      name: "CNN Fear & Greed Index",
      category: "情绪总表",
      source: "CNN",
      symbol: "Fear & Greed",
      status: "ok",
      unit: "/100",
      value: round(current, 1),
      change: round(current - previous, 1),
      changePct: null,
      trend20: round(current - value20, 1),
      trend60: round(current - value60, 1),
      score: round(score, 2),
      state,
      stateLabel: stateLabel(state),
      updatedAt: json.fear_and_greed?.timestamp || new Date().toISOString(),
      why: "CNN Fear & Greed Index 将动量、市场宽度、期权、波动率、信用和避险需求合成为 0-100 情绪读数。",
      reading: buildFearGreedReading(current, json.fear_and_greed?.rating, score),
      signals,
      history: history.slice(-80).map((point) => ({ date: point.date, value: round(point.value, 1) }))
    }];
  } catch (error) {
    return [unavailableIndicator({
      id: "fear_greed",
      name: "CNN Fear & Greed Index",
      category: "情绪总表",
      unit: "/100",
      why: "CNN Fear & Greed Index 是视频明确提到的综合情绪指标。"
    }, "CNN", error)];
  }
}

async function fetchYahooIndicators() {
  const tasks = yahooIndicators.map(async (config) => {
    try {
      const result = await fetchYahooChart(config.symbol);
      const points = normalizeYahooPoints(result, config);
      if (points.length < 2) throw new Error("Not enough price history");
      return buildMarketIndicator(config, points, result.meta);
    } catch (error) {
      return unavailableIndicator(config, "Yahoo Finance", error);
    }
  });
  return Promise.all(tasks);
}

async function fetchYahooChart(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=6mo&interval=1d`;
  const json = await fetchJson(url, YAHOO_TIMEOUT_MS);
  const result = json.chart?.result?.[0];
  if (!result) throw new Error(json.chart?.error?.description || "Yahoo returned no chart result");
  return result;
}

async function fetchFredIndicators() {
  const tasks = fredIndicators.map(async (config) => {
    try {
      const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(config.series)}`;
      const text = await fetchText(url, FRED_TIMEOUT_MS);
      const rows = parseFredCsv(text, config.series);
      if (rows.length < 2) throw new Error("Not enough FRED observations");
      return buildFredIndicator(config, rows);
    } catch (error) {
      return unavailableIndicator(config, "FRED", error);
    }
  });
  return Promise.all(tasks);
}

function normalizeYahooPoints(result, config) {
  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  return timestamps
    .map((timestamp, index) => {
      const raw = quote.close?.[index];
      if (!Number.isFinite(raw)) return null;
      return {
        date: new Date(timestamp * 1000).toISOString().slice(0, 10),
        value: transformYahooValue(raw, config)
      };
    })
    .filter(Boolean);
}

function transformYahooValue(value, config) {
  return value;
}

function buildMarketIndicator(config, points, meta) {
  const current = points.at(-1).value;
  const previous = points.at(-2).value;
  const value20 = points.at(-21)?.value ?? points[0].value;
  const value60 = points.at(-61)?.value ?? points[0].value;
  const change = current - previous;
  const changePct = pct(current, previous);
  const trend20 = pct(current, value20);
  const trend60 = pct(current, value60);
  const score = scoreIndicator(config, current, changePct, trend20, trend60);
  const state = scoreToState(score);
  const signals = analyzeSignals(config, points);
  return {
    id: config.id,
    name: config.name,
    category: config.category,
    source: "Yahoo Finance",
    symbol: config.symbol,
    status: "ok",
    unit: config.unit,
    value: round(current, valuePrecision(current)),
    change: round(change, valuePrecision(change)),
    changePct: round(changePct, 2),
    trend20: round(trend20, 2),
    trend60: round(trend60, 2),
    score: round(score, 2),
    state,
    stateLabel: stateLabel(state),
    updatedAt: meta?.regularMarketTime
      ? new Date(meta.regularMarketTime * 1000).toISOString()
      : points.at(-1).date,
    why: config.why,
    reading: buildReading(config, state, current, changePct, trend20),
    signals,
    history: points.slice(-80).map((item) => ({ date: item.date, value: round(item.value, valuePrecision(item.value)) }))
  };
}

function buildFredIndicator(config, rows) {
  let derivedRows = rows;
  if (config.transform === "monthlyChange") {
    derivedRows = rows.slice(1).map((row, index) => ({
      date: row.date,
      value: row.value - rows[index].value
    }));
  }
  if (config.transform === "yoy") {
    derivedRows = rows.slice(12).map((row, index) => ({
      date: row.date,
      value: pct(row.value, rows[index].value)
    }));
  }
  derivedRows = derivedRows.filter((row) => isPlausibleFredValue(config, row.value));

  const current = derivedRows.at(-1).value;
  const previous = derivedRows.at(-2).value;
  const value6 = derivedRows.at(-7)?.value ?? derivedRows[0].value;
  const value12 = derivedRows.at(-13)?.value ?? derivedRows[0].value;
  const change = current - previous;
  const trend20 = current - value6;
  const trend60 = current - value12;
  const score = scoreIndicator(config, current, change, trend20, trend60);
  const state = scoreToState(score);
  const signals = analyzeSignals(config, derivedRows);

  return {
    id: config.id,
    name: config.name,
    category: config.category,
    source: "FRED",
    symbol: config.series,
    status: "ok",
    unit: config.unit,
    value: round(current, config.unit === "百万美元" ? 0 : 2),
    change: round(change, 2),
    changePct: null,
    trend20: round(trend20, 2),
    trend60: round(trend60, 2),
    score: round(score, 2),
    state,
    stateLabel: stateLabel(state),
    updatedAt: derivedRows.at(-1).date,
    why: config.why,
    reading: buildReading(config, state, current, change, trend20),
    signals,
    history: derivedRows.slice(-80).map((item) => ({ date: item.date, value: round(item.value, 2) }))
  };
}

function analyzeSignals(config, points) {
  if (!points || points.length < 4) return [];
  const profile = signalProfile(config);
  const changes = buildSignalChanges(points, profile);
  if (!changes.length) return [];
  const signals = [];
  const latest = changes.at(-1);
  const recent = changes.slice(-Math.min(profile.volLookback, changes.length));
  const avgAbs = recent.reduce((sum, item) => sum + Math.abs(item.change), 0) / recent.length;
  const breakoutThreshold = Math.max(profile.breakoutMin, avgAbs * profile.breakoutMultiple);

  if (Math.abs(latest.change) >= breakoutThreshold) {
    const direction = latest.change > 0 ? "up" : "down";
    signals.push({
      type: "breakout",
      direction,
      severity: Math.abs(latest.change) >= breakoutThreshold * 1.7 ? "high" : "medium",
      label: direction === "up" ? "突然跳高" : "突然跳低",
      detail: `${formatSignalChange(latest.change, profile)}，超过该指标突破阈值 ${formatSignalChange(breakoutThreshold, profile)}。`,
      window: "latest",
      value: round(latest.change, profile.digits),
      threshold: round(breakoutThreshold, profile.digits)
    });
  }

  const streakWindow = points.slice(-Math.min(profile.persistenceWindow + 1, points.length));
  const streakChanges = buildSignalChanges(streakWindow, profile);
  const meaningful = streakChanges.filter((item) => Math.abs(item.change) >= profile.noise);
  if (meaningful.length >= profile.minDirectionalMoves) {
    const upCount = meaningful.filter((item) => item.change > 0).length;
    const downCount = meaningful.filter((item) => item.change < 0).length;
    const total = meaningful.length;
    const start = streakWindow[0].value;
    const end = streakWindow.at(-1).value;
    const net = profile.mode === "pct" ? pct(end, start) : end - start;
    const upRatio = upCount / total;
    const downRatio = downCount / total;
    if (upRatio >= profile.persistenceRatio && net >= profile.persistenceMinNet) {
      signals.push({
        type: "persistence",
        direction: "up",
        severity: upRatio >= 0.9 ? "high" : "medium",
        label: "持续上行",
        detail: `最近 ${total} 次有效变化中 ${Math.round(upRatio * 100)}% 向上，净变化 ${formatSignalChange(net, profile)}。`,
        window: `${streakWindow.length} points`,
        ratio: round(upRatio, 2),
        value: round(net, profile.digits)
      });
    }
    if (downRatio >= profile.persistenceRatio && net <= -profile.persistenceMinNet) {
      signals.push({
        type: "persistence",
        direction: "down",
        severity: downRatio >= 0.9 ? "high" : "medium",
        label: "持续下行",
        detail: `最近 ${total} 次有效变化中 ${Math.round(downRatio * 100)}% 向下，净变化 ${formatSignalChange(net, profile)}。`,
        window: `${streakWindow.length} points`,
        ratio: round(downRatio, 2),
        value: round(net, profile.digits)
      });
    }
  }

  return signals.slice(0, 2);
}

function buildSignalChanges(points, profile) {
  const changes = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1].value;
    const current = points[index].value;
    if (!Number.isFinite(previous) || !Number.isFinite(current)) continue;
    changes.push({
      date: points[index].date,
      change: profile.mode === "pct" ? pct(current, previous) : current - previous
    });
  }
  return changes.filter((item) => Number.isFinite(item.change));
}

function signalProfile(config) {
  const base = {
    mode: "pct",
    breakoutMin: 1.8,
    breakoutMultiple: 2.4,
    volLookback: 30,
    persistenceWindow: 10,
    persistenceRatio: 0.8,
    persistenceMinNet: 3,
    minDirectionalMoves: 5,
    noise: 0.05,
    digits: 2,
    suffix: "%"
  };
  const overrides = {
    vix: { breakoutMin: 10, persistenceMinNet: 18, noise: 1 },
    dxy: { breakoutMin: 0.7, persistenceMinNet: 1.2, noise: 0.08 },
    cnh: { breakoutMin: 0.35, persistenceMinNet: 0.75, noise: 0.04 },
    gold: { breakoutMin: 1.4, persistenceMinNet: 3, noise: 0.15 },
    oil: { breakoutMin: 3.5, persistenceMinNet: 7, noise: 0.4 },
    btc: { breakoutMin: 4.5, persistenceMinNet: 10, noise: 0.5 },
    spx: { breakoutMin: 1.5, persistenceMinNet: 3, noise: 0.12 },
    nasdaq: { breakoutMin: 2, persistenceMinNet: 4, noise: 0.15 },
    rut: { breakoutMin: 2.4, persistenceMinNet: 5, noise: 0.2 },
    shanghai: { breakoutMin: 1.8, persistenceMinNet: 3.5, noise: 0.12 },
    hsi: { breakoutMin: 2.4, persistenceMinNet: 5, noise: 0.18 },
    kweb: { breakoutMin: 3.2, persistenceMinNet: 8, noise: 0.3 },
    rsp_spy: { breakoutMin: 0.8, persistenceMinNet: 1.6, noise: 0.06 },
    iwm_spy: { breakoutMin: 1.1, persistenceMinNet: 2.2, noise: 0.08 },
    hyg_lqd: { breakoutMin: 0.45, persistenceMinNet: 0.9, noise: 0.04 },
    tnx: levelProfile(0.12, 0.28, 0.015, 2),
    irx: levelProfile(0.08, 0.18, 0.01, 2),
    fed_funds: levelProfile(0.1, 0.2, 0.005, 2, 8),
    cpi_yoy: levelProfile(0.25, 0.45, 0.03, 2, 8),
    unemployment: levelProfile(0.2, 0.35, 0.02, 2, 8),
    payrolls: levelProfile(100, 180, 15, 0, 8, "千人"),
    fed_balance: { breakoutMin: 1.2, persistenceMinNet: 2.2, noise: 0.08 },
    fear_greed: levelProfile(8, 14, 1, 1, 10, "点")
  };
  return { ...base, ...(overrides[config.id] || {}) };
}

function levelProfile(breakoutMin, persistenceMinNet, noise, digits = 2, persistenceWindow = 10, suffix = "点") {
  return {
    mode: "level",
    breakoutMin,
    breakoutMultiple: 2.2,
    volLookback: 24,
    persistenceWindow,
    persistenceRatio: 0.8,
    persistenceMinNet,
    minDirectionalMoves: 4,
    noise,
    digits,
    suffix
  };
}

function formatSignalChange(value, profile) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${round(value, profile.digits)}${profile.suffix}`;
}

function scoreIndicator(config, current, change1, trend20, trend60) {
  const directional = clamp((change1 * 0.25 + trend20 * 0.5 + trend60 * 0.25) / 6, -1, 1);
  let level = 0;
  if (config.id === "vix") {
    if (current >= 30) level = -1;
    else if (current >= 25) level = -0.65;
    else if (current <= 13) level = 0.75;
    else if (current <= 16) level = 0.4;
  }
  if (config.id === "tnx") {
    if (current >= 4.8) level = -0.8;
    else if (current >= 4.4) level = -0.45;
    else if (current <= 3.6) level = 0.35;
  }
  if (config.id === "irx" || config.id === "fed_funds") {
    if (current >= 5) level = -0.55;
    else if (current <= 3.5) level = 0.35;
  }
  if (config.id === "cpi_yoy") {
    if (current >= 3.5) level = -0.75;
    else if (current <= 2.5) level = 0.45;
  }
  if (config.id === "payrolls") {
    if (current >= 250) level = -0.1;
    else if (current >= 90) level = 0.35;
    else if (current < 25) level = -0.5;
  }
  if (config.id === "unemployment") {
    if (current >= 4.6) level = -0.65;
    else if (current <= 3.8) level = 0.25;
  }

  return clamp((directional * config.sensitivity * 0.7) + (level * 0.3), -1, 1);
}

function scoreFearGreed(current, previousMonth) {
  if (current <= 20) return 0.85;
  if (current <= 35) return 0.45;
  if (current >= 80) return -0.85;
  if (current >= 65) return -0.35;
  return clamp((current - previousMonth) / 35, -0.25, 0.25);
}

function buildFearGreedReading(value, rating, score) {
  const label = rating ? String(rating).replace(/_/g, " ") : "unknown";
  if (score > 0.25) return `CNN Fear & Greed 当前为 ${round(value, 1)}/100（${label}），偏恐惧区间更接近逆向加仓观察信号。`;
  if (score < -0.25) return `CNN Fear & Greed 当前为 ${round(value, 1)}/100（${label}），偏贪婪区间提示短线追高风险上升。`;
  return `CNN Fear & Greed 当前为 ${round(value, 1)}/100（${label}），情绪不极端，需结合 VIX、市场广度和信用市场确认。`;
}

function buildReading(config, state, current, change1, trend20) {
  const move = trend20 > 1 ? "近阶段上行" : trend20 < -1 ? "近阶段下行" : "近阶段横向震荡";
  const supportiveText = config.sensitivity < 0 ? config.low : config.high;
  const pressureText = config.sensitivity < 0 ? config.high : config.low;
  const stateText = state === "supportive"
    ? supportiveText
    : state === "pressure"
      ? pressureText
      : "当前信号偏中性，需要和同组指标交叉验证。";
  return `${config.name}${move}，最新值 ${formatValue(current, config.unit)}。${stateText}`;
}

function unavailableIndicator(config, source, error) {
  return {
    id: config.id,
    name: config.name,
    category: config.category,
    source,
    symbol: config.symbol || config.series,
    status: "unavailable",
    unit: config.unit,
    value: null,
    change: null,
    changePct: null,
    trend20: null,
    trend60: null,
    score: 0,
    state: "missing",
    stateLabel: "数据缺失",
    updatedAt: null,
    why: config.why,
    reading: `${config.name}当前数据源暂时不可用，综合解读会降低该指标权重。`,
    signals: [],
    error: error?.message || String(error),
    history: []
  };
}

function buildDimensions(indicators) {
  const groups = new Map();
  for (const item of indicators) {
    if (!groups.has(item.category)) groups.set(item.category, []);
    groups.get(item.category).push(item);
  }
  return [...groups.entries()].map(([name, items]) => {
    const live = items.filter((item) => item.status === "ok");
    const score = weightedAverage(live, "score");
    return {
      name,
      score: round(score, 2),
      state: scoreToState(score),
      stateLabel: stateLabel(scoreToState(score)),
      coverage: `${live.length}/${items.length}`,
      indicators: items.map((item) => item.id)
    };
  }).sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
}

function synthesizeFramework(framework, indicators, dimensions) {
  const frameworkCategories = new Set(Object.keys(framework.weights));
  const includeIds = framework.includeIds ? new Set(framework.includeIds) : null;
  const relevantIndicators = indicators.filter((item) => (
    includeIds ? includeIds.has(item.id) : frameworkCategories.has(item.category)
  ));
  const weighted = [];
  for (const [category, weight] of Object.entries(framework.weights)) {
    if (includeIds) {
      const categoryIndicators = relevantIndicators.filter((item) => item.category === category && item.status === "ok");
      if (categoryIndicators.length) weighted.push({ score: weightedAverage(categoryIndicators, "score"), weight });
    } else {
      const dimension = dimensions.find((item) => item.name === category);
      if (dimension) weighted.push({ score: dimension.score, weight });
    }
  }
  const score = weighted.length
    ? weighted.reduce((sum, item) => sum + item.score * item.weight, 0) / weighted.reduce((sum, item) => sum + item.weight, 0)
    : 0;
  const topPressures = relevantIndicators.filter((item) => item.status === "ok" && item.score < -0.25).slice(0, 3);
  const topSupports = relevantIndicators.filter((item) => item.status === "ok" && item.score > 0.25).slice(0, 3);
  return {
    ...framework,
    score: round(score, 2),
    state: scoreToState(score),
    stateLabel: stateLabel(scoreToState(score)),
    summary: frameworkSummary(framework.id, score, topSupports, topPressures),
    tactical: tacticalSuggestion(framework.id, score, topSupports, topPressures),
    supports: topSupports.map((item) => ({ id: item.id, name: item.name, reading: item.reading, score: item.score })),
    pressures: topPressures.map((item) => ({ id: item.id, name: item.name, reading: item.reading, score: item.score }))
  };
}

function frameworkSummary(id, score, supports, pressures) {
  const supportNames = supports.map((item) => item.name).join("、") || "暂无明确支撑";
  const pressureNames = pressures.map((item) => item.name).join("、") || "暂无明确压力";
  if (id === "black-swan-response") {
    if (score < -0.3) return `冲击环境偏强，主要压力来自 ${pressureNames}。优质股下跌时先判断是否为系统性冲击，再分批响应。`;
    return `系统性冲击未显著放大，支撑来自 ${supportNames}，个股黑天鹅更需要回到基本面和估值安全边际。`;
  }
  if (id === "china-cross-border") {
    return score >= 0
      ? `中国资产跨境定价偏暖，支撑来自 ${supportNames}。可关注人民币、港股和中概是否同步确认。`
      : `中国资产跨境定价仍有压力，主要来自 ${pressureNames}。低吸更适合等待汇率和港股企稳。`;
  }
  if (score > 0.3) return `市场氛围偏进攻，支撑来自 ${supportNames}。短线可以更重视趋势延续和强势股回踩。`;
  if (score < -0.3) return `市场氛围偏防守，主要压力来自 ${pressureNames}。高抛低吸应降低追涨，优先等待恐慌释放。`;
  return `市场氛围中性拉扯，支撑来自 ${supportNames}，压力来自 ${pressureNames}。更适合用计划价格和仓位纪律处理波动。`;
}

function tacticalSuggestion(id, score) {
  if (id === "black-swan-response") {
    if (score < -0.35) return "先查系统性风险，再看个股是否被错杀；优质股可用分层买单，不一次性打满。";
    return "若个股突发利空但系统指标稳定，重点评估现金流、监管和竞争格局是否改变。";
  }
  if (score > 0.45) return "偏进攻环境，长期看好的股票可把回踩视为加仓观察区，同时设置高抛价格。";
  if (score < -0.45) return "偏防守环境，降低追高动作，把资金留给极端波动后的优质资产。";
  return "中性环境，适合用网格、分批和事件触发规则，避免单一指标驱动交易。";
}

function buildFlags(indicators, marketScore, anomalyRadar = null) {
  const byId = Object.fromEntries(indicators.map((item) => [item.id, item]));
  const flags = [];
  const leaderAlerts = anomalyRadar?.legacyLeaderAlerts || [];
  if (leaderAlerts.length) {
    const top = leaderAlerts[0];
    flags.push({
      level: top.direction === "down" ? "danger" : "warning",
      title: `${top.symbol} ${top.direction === "down" ? "龙头大跌" : "龙头大涨"}`,
      detail: top.explanation
    });
  }
  const sectorAlerts = (anomalyRadar?.sectorMoves || []).filter((item) => item.severity === "high");
  if (sectorAlerts.length) {
    const top = sectorAlerts[0];
    flags.push({
      level: top.direction === "down" ? "warning" : "good",
      title: `${top.name}板块异常${top.direction === "down" ? "下跌" : "上涨"}`,
      detail: top.explanation
    });
  }
  const signalAlerts = indicators
    .flatMap((item) => (item.signals || []).map((signal) => ({ item, signal })))
    .filter(({ signal }) => signal.severity === "high" || signal.type === "breakout")
    .slice(0, 3);
  for (const { item, signal } of signalAlerts) {
    flags.push({
      level: signalFlagLevel(item, signal),
      title: `${item.name}${signal.label}`,
      detail: signal.detail
    });
  }
  if (byId.vix?.value >= 25) flags.push({ level: "danger", title: "波动率升温", detail: "VIX 高于 25，短线仓位和止损要更保守。" });
  if (byId.dxy?.trend20 > 2) flags.push({ level: "warning", title: "美元走强", detail: "美元近阶段明显上行，全球风险资产估值承压。" });
  if (byId.tnx?.trend20 > 0.25) flags.push({ level: "warning", title: "长端利率上行", detail: "10 年期收益率抬升，成长股估值压力增加。" });
  if (byId.gold?.trend20 > 5 && byId.vix?.trend20 > 5) flags.push({ level: "warning", title: "避险共振", detail: "黄金和波动率同步上行，需排查地缘或信用风险。" });
  if (marketScore > 0.45) flags.push({ level: "good", title: "风险偏好较强", detail: "综合氛围偏进攻，注意强势股拥挤后的高抛纪律。" });
  if (marketScore < -0.45) flags.push({ level: "danger", title: "综合氛围偏防守", detail: "系统性压力偏高，低吸应分批并等待确认。" });
  if (!flags.length) flags.push({ level: "neutral", title: "没有极端信号", detail: "当前更像结构性行情，重点比较板块和个股相对强弱。" });
  return flags;
}

function signalFlagLevel(item, signal) {
  const config = [...yahooIndicators, ...fredIndicators, ...ratioIndicators].find((candidate) => candidate.id === item.id);
  const sensitivity = config?.sensitivity ?? (item.id === "fear_greed" ? -0.3 : 0);
  const supportiveDirection = sensitivity >= 0 ? "up" : "down";
  if (signal.severity === "high" && signal.direction !== supportiveDirection) return "danger";
  if (signal.direction !== supportiveDirection) return "warning";
  return "good";
}

function classifyRegime(score) {
  if (score >= 0.45) return { name: "进攻", description: "风险偏好和趋势信号占优，适合顺势但不适合无纪律追高。" };
  if (score >= 0.15) return { name: "温和偏暖", description: "整体环境可交易，但仍要观察利率、美元和波动率是否反向。" };
  if (score <= -0.45) return { name: "防守", description: "系统性压力较大，优先保护本金和等待错杀机会。" };
  if (score <= -0.15) return { name: "温和偏冷", description: "短线胜率下降，适合降低仓位或只做确定性更高的回踩。" };
  return { name: "中性拉扯", description: "多空信号交错，适合依赖计划交易和个股级别催化。" };
}

function parseFredCsv(text, column) {
  return text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const [date, rawValue] = line.split(",");
      const value = Number(rawValue);
      if (!date || !Number.isFinite(value)) return null;
      return { date, value };
    })
    .filter(Boolean);
}

function isPlausibleFredValue(config, value) {
  if (!Number.isFinite(value)) return false;
  if (config.transform === "yoy") return value > -20 && value < 20;
  if (config.transform === "monthlyChange") return value > -5000 && value < 5000;
  return true;
}

async function fetchJson(url, timeoutMs, headers = {}) {
  const response = await fetchWithTimeout(url, timeoutMs, headers);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchText(url, timeoutMs) {
  const response = await fetchWithTimeout(url, timeoutMs);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function fetchWithTimeout(url, timeoutMs, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) market-atmosphere-dashboard/0.1",
        ...headers
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

function weightedAverage(items, key) {
  if (!items.length) return 0;
  return items.reduce((sum, item) => sum + (Number(item[key]) || 0), 0) / items.length;
}

function pct(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function valuePrecision(value) {
  const abs = Math.abs(value);
  if (abs >= 1000) return 1;
  if (abs >= 100) return 2;
  return 3;
}

function scoreToState(score) {
  if (score >= 0.25) return "supportive";
  if (score <= -0.25) return "pressure";
  return "neutral";
}

function stateLabel(state) {
  return {
    supportive: "支撑",
    pressure: "压力",
    neutral: "中性",
    missing: "数据缺失"
  }[state] || "中性";
}

function formatValue(value, unit) {
  if (!Number.isFinite(value)) return "不可用";
  return `${round(value, valuePrecision(value)).toLocaleString("zh-CN")}${unit ? ` ${unit}` : ""}`;
}
