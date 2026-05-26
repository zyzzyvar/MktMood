const macroEventPlaybooks = [
  {
    id: "consumer-confidence",
    match: ["consumer confidence", "cb consumer confidence", "conference board"],
    title: "消费者信心",
    plain: "它衡量普通消费者对当前经济、就业和未来收入的信心。信心强，通常意味着消费者更愿意花钱。",
    professional: "美国消费占 GDP 比重很高，消费者信心会影响零售、服务消费、企业收入预期和软着陆/衰退判断。",
    higher: "高于预期通常说明消费韧性更强，利好可选消费、零售和整体风险偏好；但若通胀压力仍高，也可能推高利率预期。",
    lower: "低于预期通常说明消费动能转弱，周期股和消费股可能承压；若同时通胀降温，长债和降息交易可能受益。",
    largeHigh: "远高于预期时，重点看 10 年期美债收益率和美元是否上行。如果利率也上行，成长股可能反而被估值压力压制。",
    largeLow: "远低于预期时，重点判断是温和降温还是衰退担忧。如果 VIX 上升、股指下跌，先按风险事件处理。",
    attention: "发布后先看实际值相对共识和前值的方向，再看 XLY、XLP、TLT、DXY 是否确认。",
    actionHint: "若数据弱但市场不跌、长债走强，优质成长股回撤可观察；若数据弱且 VIX 升高，先降低低吸冲动。",
    watchAssets: ["XLY", "XLP", "SPY", "TLT", "DXY"],
    thresholds: { mild: "1-3 点", large: "超过 3 点" }
  },
  {
    id: "core-pce",
    match: ["core pce", "pce price index", "pce prices"],
    title: "PCE 通胀",
    plain: "PCE 是美联储更重视的通胀指标，核心 PCE 剔除了食品和能源，更能反映通胀黏性。",
    professional: "PCE 会直接影响降息路径、实际利率和权益估值倍数，核心 PCE 的服务项和环比变化尤其关键。",
    higher: "高于预期通常意味着通胀更黏，降息预期后移，长端利率和美元可能上行，成长股估值承压。",
    lower: "低于预期通常利好降息交易和估值扩张，科技、长久期资产和黄金可能受益。",
    largeHigh: "远高于预期时，要警惕股债双杀：利率上行压估值，风险偏好下降。优先观察 QQQ、TLT、DXY、黄金的同步反应。",
    largeLow: "远低于预期时，若增长数据没有同步恶化，通常是较好的风险资产环境；若增长也弱，则可能转为衰退交易。",
    attention: "重点看环比是否连续高于 0.3%，以及市场是否重新定价下一次降息时间。",
    actionHint: "通胀超预期时减少追高成长股；通胀低于预期且利率下行时，长期看好的科技/成长股回踩更值得关注。",
    watchAssets: ["TNX", "TLT", "DXY", "QQQ", "GLD", "SPY"],
    thresholds: { mild: "0.1 个百分点", large: "0.2 个百分点以上" }
  },
  {
    id: "cpi",
    match: ["cpi", "consumer price index"],
    title: "CPI 通胀",
    plain: "CPI 衡量居民生活成本变化，是市场最敏感的通胀数据之一。",
    professional: "CPI 会影响美联储政策预期、名义利率、实际利率和风险资产估值。核心 CPI 比总体 CPI 更能反映通胀黏性。",
    higher: "高于预期通常压制降息预期，利空长久期成长股，利好美元和短端利率。",
    lower: "低于预期通常缓解政策压力，利好债券、黄金和成长股估值。",
    largeHigh: "远高于预期时，要警惕市场从软着陆转向再通胀交易，优先控制仓位和追高风险。",
    largeLow: "远低于预期时，如果就业和消费仍稳，通常利好风险资产；如果增长也弱，则可能变成衰退担忧。",
    attention: "看核心项、服务项、住房项是否同步降温，单看总体 CPI 容易被能源扰动误导。",
    actionHint: "CPI 大超预期时，先等利率和美元反应稳定；CPI 明显低于预期时，可关注被利率压制的优质成长股。",
    watchAssets: ["TNX", "DXY", "QQQ", "TLT", "GLD"],
    thresholds: { mild: "0.1 个百分点", large: "0.2 个百分点以上" }
  },
  {
    id: "gdp",
    match: ["gdp growth", "gdp price", "gdp sales", "real consumer spending"],
    title: "GDP 与增长",
    plain: "GDP 是经济总量的增长速度，告诉我们经济是在加速、放缓还是接近衰退。",
    professional: "GDP 影响企业盈利周期、周期股表现和软着陆判断。分项里消费、投资和价格指数能帮助区分真实增长与通胀推高。",
    higher: "高于预期通常说明增长更强，利好周期股和盈利预期；但也可能推迟降息。",
    lower: "低于预期通常说明增长放缓，周期股承压；若通胀也降温，降息交易可能获得支撑。",
    largeHigh: "远高于预期时，重点看利率是否上行。如果利率大涨，成长股可能不跟随经济利好。",
    largeLow: "远低于预期时，先判断是否触发衰退交易：VIX、信用债和小盘股会给出确认。",
    attention: "不要只看 headline，消费和价格分项能决定市场把它解读为好增长还是坏通胀。",
    actionHint: "强 GDP + 利率温和时可偏进攻；弱 GDP + 信用走弱时，优质股低吸也要分批。",
    watchAssets: ["SPY", "IWM", "HYG", "TLT", "TNX"],
    thresholds: { mild: "0.3-0.5 个百分点", large: "超过 0.8 个百分点" }
  },
  {
    id: "nonfarm-payrolls",
    match: ["non farm payrolls", "nonfarm payrolls", "non-farm payrolls"],
    title: "非农就业",
    plain: "非农就业看美国一个月新增了多少工作岗位，是判断经济热不热、就业稳不稳的核心数据。",
    professional: "非农同时影响增长、工资通胀和美联储反应函数。新增就业、失业率、工资增速要一起看。",
    higher: "高于预期说明经济韧性强，短期利好增长和风险偏好；但若工资也强，可能推迟降息。",
    lower: "低于预期说明劳动力市场降温，可能利好降息预期；若过弱则会抬高衰退风险。",
    largeHigh: "远高于预期且工资强时，利率和美元可能上行，成长股估值承压。",
    largeLow: "远低于预期时，先看失业率是否同步上升。如果同步恶化，风险资产可能先跌后等政策托底。",
    attention: "重点看新增就业、失业率、平均时薪三者是否同向。单一 headline 容易误判。",
    actionHint: "就业温和降温通常利好风险资产；就业断崖式转弱时，不急着低吸，先看信用和 VIX。",
    watchAssets: ["TNX", "DXY", "IWM", "HYG", "QQQ"],
    thresholds: { mild: "5-10 万人", large: "超过 15 万人" }
  },
  {
    id: "unemployment",
    match: ["unemployment rate"],
    title: "失业率",
    plain: "失业率表示劳动力中有多少人在找工作但没有工作，是经济压力的直观指标。",
    professional: "失业率上升会影响收入、消费、信用风险和衰退概率，也是美联储就业目标的重要输入。",
    higher: "高于预期通常代表就业转弱，利空周期和消费；但可能强化降息预期。",
    lower: "低于预期说明就业仍紧，增长韧性更强；但也可能让美联储更谨慎降息。",
    largeHigh: "失业率远高于预期时，市场可能从降息利好转向衰退担忧，优先观察 VIX 和信用债。",
    largeLow: "失业率远低于预期时，若工资也强，利率可能上行，成长股承压。",
    attention: "结合非农新增和工资一起看，失业率单独变化有时受劳动参与率影响。",
    actionHint: "失业率温和上行可关注降息受益资产；快速上行则先保护仓位。",
    watchAssets: ["HYG", "IWM", "VIX", "TLT", "SPY"],
    thresholds: { mild: "0.1 个百分点", large: "0.2 个百分点以上" }
  },
  {
    id: "average-hourly-earnings",
    match: ["average hourly earnings", "wage"],
    title: "工资增速",
    plain: "工资增速看普通员工收入涨得快不快，工资涨得快会支撑消费，也可能推高服务通胀。",
    professional: "平均时薪影响服务通胀黏性、企业利润率和美联储对劳动力市场的判断。",
    higher: "高于预期说明收入和消费韧性强，但也可能让通胀更黏、降息更慢。",
    lower: "低于预期说明工资压力缓解，利好通胀降温和降息交易；但过弱也可能压制消费。",
    largeHigh: "远高于预期时，重点看利率是否跳升，成长股和高估值资产容易承压。",
    largeLow: "远低于预期时，如果就业仍稳，通常利好软着陆；如果就业也弱，则是衰退信号。",
    attention: "工资要和非农、失业率一起看，强工资 + 弱就业是比较复杂的组合。",
    actionHint: "工资超预期时避免追高长久期成长股；工资温和降温时关注估值修复机会。",
    watchAssets: ["TNX", "DXY", "QQQ", "XLY"],
    thresholds: { mild: "0.1 个百分点", large: "0.2 个百分点以上" }
  },
  {
    id: "retail-sales",
    match: ["retail sales"],
    title: "零售销售",
    plain: "零售销售看消费者买东西的金额变化，是消费热度的高频指标。",
    professional: "零售销售影响消费股、GDP nowcast、企业收入预期和库存周期判断。",
    higher: "高于预期说明消费需求更强，利好零售、支付、可选消费；但可能增加通胀和利率压力。",
    lower: "低于预期说明消费降温，消费股和周期股可能承压；若通胀同步降温，降息预期可能改善。",
    largeHigh: "远高于预期时，重点看利率和美元是否上行，市场可能把它解读为经济过热。",
    largeLow: "远低于预期时，警惕消费断层和盈利下修，尤其关注 XLY、零售股和信用市场。",
    attention: "核心零售销售比总量更重要，因为汽车和油价会扰动 headline。",
    actionHint: "消费明显转弱时，不急于低吸零售和可选消费；若只是温和降温且利率下行，可关注优质消费龙头。",
    watchAssets: ["XLY", "XLP", "V", "MA", "WMT", "COST", "TLT"],
    thresholds: { mild: "0.3 个百分点", large: "0.7 个百分点以上" }
  },
  {
    id: "ism-pmi",
    match: ["ism", "pmi"],
    title: "PMI/ISM 景气指数",
    plain: "PMI/ISM 像企业景气温度计，50 以上通常代表扩张，50 以下通常代表收缩。",
    professional: "PMI/ISM 的新订单、就业、价格分项能提前反映增长、通胀和企业利润周期。",
    higher: "高于预期说明企业景气改善，利好周期、工业、材料和小盘；但价格分项走高可能带来通胀压力。",
    lower: "低于预期说明企业景气转弱，周期股承压；若价格分项回落，债券可能受益。",
    largeHigh: "远高于预期且新订单强时，可能是周期复苏信号；若价格也强，利率压力会上升。",
    largeLow: "远低于预期时，警惕增长动能恶化，观察 IWM、HYG、工业和材料板块是否同步走弱。",
    attention: "重点拆分新订单、就业、价格三项，headline 只是入口。",
    actionHint: "景气改善可关注周期扩散；景气明显恶化时，优质股低吸也要等系统风险稳定。",
    watchAssets: ["IWM", "XLI", "XLB", "HYG", "TLT"],
    thresholds: { mild: "1-2 点", large: "超过 3 点" }
  },
  {
    id: "jobless-claims",
    match: ["jobless claims", "initial jobless"],
    title: "初请失业金",
    plain: "初请失业金看每周新申请失业救济的人数，是就业市场变化最快的指标之一。",
    professional: "初请失业金能提前反映裁员压力，对衰退概率、消费收入和政策预期有高频参考价值。",
    higher: "高于预期说明就业压力上升，可能压制风险偏好；但也会强化降息预期。",
    lower: "低于预期说明就业仍稳，利好增长判断；但可能让降息预期后移。",
    largeHigh: "连续大幅高于预期比单周跳升更重要，若信用债也走弱，要提高防守。",
    largeLow: "远低于预期且持续时，说明劳动力市场仍紧，利率可能维持高位。",
    attention: "看四周均值比单周数据更可靠，节假日和季调会带来噪声。",
    actionHint: "初请持续走高时降低追高，等待 VIX 和信用市场确认是否系统性转弱。",
    watchAssets: ["HYG", "IWM", "TLT", "VIX"],
    thresholds: { mild: "1-2 万人", large: "超过 3 万人" }
  },
  {
    id: "durable-goods",
    match: ["durable goods"],
    title: "耐用品订单",
    plain: "耐用品订单看企业和消费者购买大型耐用商品的需求，比如飞机、设备和汽车。",
    professional: "耐用品订单反映资本开支、制造业需求和工业周期，核心资本品订单尤其重要。",
    higher: "高于预期说明投资和制造需求较强，利好工业、材料和周期股。",
    lower: "低于预期说明投资需求转弱，周期和工业链条可能承压。",
    largeHigh: "远高于预期时，要确认是否由飞机订单等一次性项目驱动，核心资本品更有参考价值。",
    largeLow: "远低于预期且核心订单也弱时，可能提示企业资本开支收缩。",
    attention: "重点看剔除运输后的订单和核心资本品订单。",
    actionHint: "周期数据强但利率不升时可关注工业链；数据弱时减少顺周期低吸。",
    watchAssets: ["XLI", "XLB", "CAT", "GE", "IWM"],
    thresholds: { mild: "1 个百分点", large: "超过 2 个百分点" }
  },
  {
    id: "housing",
    match: ["home sales", "housing", "building permits", "case-shiller", "house price"],
    title: "地产数据",
    plain: "地产数据看买房、建房和房价变化，是利率敏感行业的代表。",
    professional: "地产影响居民财富、银行信用、建材家居消费和利率敏感资产。房价也会间接影响住房通胀预期。",
    higher: "高于预期说明地产需求更强，利好地产链和家装消费；但也可能支撑住房通胀。",
    lower: "低于预期说明高利率压制需求，地产链和区域银行可能承压。",
    largeHigh: "远高于预期时，关注房价和利率是否同步上行，避免把通胀压力误判为纯增长利好。",
    largeLow: "远低于预期时，若区域银行和信用也走弱，可能放大系统性担忧。",
    attention: "新屋、成屋、许可、开工、房价分别代表不同环节，不要混为一谈。",
    actionHint: "地产弱但利率下行时可观察优质家装/地产链；地产弱且信用走弱时保持防守。",
    watchAssets: ["XLRE", "XHB", "KRE", "HD", "LOW", "TLT"],
    thresholds: { mild: "1-3 个百分点", large: "超过 5 个百分点" }
  },
  {
    id: "fomc-rate",
    match: ["fed interest rate", "fomc", "fed funds"],
    title: "美联储利率/FOMC",
    plain: "这是美联储决定美元资金价格和政策方向的会议或声明，是所有资产定价的核心变量之一。",
    professional: "政策利率、点阵图、声明措辞和记者会会影响收益率曲线、美元、信用利差和权益估值。",
    higher: "比预期更鹰派通常意味着利率更高更久，压制成长股和高估值资产，利好美元。",
    lower: "比预期更鸽派通常利好债券和风险资产，但如果原因是经济明显转弱，股市未必受益。",
    largeHigh: "明显鹰派意外时，关注长端利率、美元和信用债是否同步恶化，先控制仓位。",
    largeLow: "明显鸽派意外时，若信用和股指同步走强，风险偏好改善；若只债券涨、股票跌，可能是衰退交易。",
    attention: "不要只看是否降息，声明、点阵图和鲍威尔口径往往更重要。",
    actionHint: "FOMC 前降低冲动交易；发布后等待利率、美元、VIX 三者方向确认。",
    watchAssets: ["TNX", "DXY", "TLT", "QQQ", "HYG", "VIX"],
    thresholds: { mild: "措辞/点阵图小幅偏离", large: "利率路径偏离 25bp 以上" }
  }
];

function findMacroEventPlaybook(event) {
  const text = `${event.title || ""} ${event.category || ""}`.toLowerCase();
  return macroEventPlaybooks.find((playbook) => playbook.match.some((keyword) => text.includes(keyword))) || null;
}

function genericMacroEventPlaybook(event) {
  return {
    id: "generic",
    title: event.theme || "宏观数据",
    plain: "这是一个会影响市场对增长、通胀或政策路径判断的宏观数据。",
    professional: "需要结合前值、市场共识、实际值和跨资产反应判断其市场含义。",
    higher: "高于预期时，先判断它代表增长改善，还是通胀/利率压力上升。",
    lower: "低于预期时，先判断它代表通胀降温，还是增长和盈利压力变大。",
    largeHigh: "远高于预期时，重点观察利率、美元和股指是否同向确认。",
    largeLow: "远低于预期时，重点观察 VIX、信用债和小盘股是否显示风险扩散。",
    attention: "先看实际值相对共识，再看相对前值，最后看跨资产确认。",
    actionHint: "数据发布后不要只看 headline，等待利率、美元、VIX 或相关板块反应确认。",
    watchAssets: ["SPY", "TNX", "DXY", "TLT", "VIX"],
    thresholds: { mild: "小幅偏离共识", large: "显著偏离共识" }
  };
}

module.exports = {
  findMacroEventPlaybook,
  genericMacroEventPlaybook
};
