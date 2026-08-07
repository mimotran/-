/**
 * 天猫数据看板 —— 统一数据模型
 *
 * 所有数据源（飞书电子表格 / 多维表格 / mock）最终都归一化成这里的结构，
 * 上层组件只认这些类型，换数据源不需要改 UI。
 */

/** 日期字符串，格式 YYYY-MM-DD */
export type DateStr = string;

export interface DateRange {
  from: DateStr;
  to: DateStr;
}

/**
 * 店铺每日核心指标。
 *
 * 只放**原始可加**的量（金额、件数、人数），比率一律在聚合后再算 ——
 * 先算每日退款率再取平均，和先汇总再相除，结果是不一样的，后者才对。
 */
export interface DailyMetric {
  date: DateStr;
  /** 支付金额 GMV（元） */
  gmv: number;
  /** 主机销量（台）——只算录音笔本体，不含配件和会员 */
  deviceSales: number;
  /** 退后 GMV（元）= GMV − 退款金额 */
  gmvAfterRefund: number;
  /** 退款金额（元） */
  refund: number;
  /** 访客数 UV */
  uv: number;
  /** 搜索 UV：来自站内搜索的访客 */
  searchUv: number;
  /** 支付人数 */
  buyers: number;
  /** 支付订单数 */
  orders: number;
  /** 加购人数 */
  addToCart: number;
  /** 新客成交金额（元）——新客率在聚合后由它除以 GMV 得出 */
  newCustomerGmv: number;
  /** 站内投放费（元） */
  adCostInsite: number;
  /** 站外投放费（元） */
  adCostOffsite: number;
  /** 站内投放带来的成交（元） */
  adGmvInsite: number;
  /** 站外投放带来的成交（元） */
  adGmvOffsite: number;
}

/** 投放的两个大盘口径 */
export type AdScope = 'insite' | 'offsite';

/**
 * 投放明细：站内按「触点」拆，站外按「渠道」拆。
 * 两者字段一致，用 scope 区分，省得写两套聚合逻辑。
 */
export interface AdMetric {
  date: DateStr;
  scope: AdScope;
  /** 站内触点（关键词推广 / 引力魔方…）或站外渠道（抖音 / 小红书…） */
  channel: string;
  /** 投放费（元） */
  cost: number;
  /** 成交金额（元） */
  gmv: number;
  /** 曝光量 */
  impressions: number;
  /** 点击量 */
  clicks: number;
}

/** 产品线。会员和配件不算主机，单独成线 */
export type ProductLine = 'pro' | 'pins' | 'note' | 'member' | 'accessory';

export interface ProductMetric {
  date: DateStr;
  line: ProductLine;
  /** 商品 ID（宝贝 ID） */
  itemId: string;
  title: string;
  gmv: number;
  /** 销量（件） */
  quantity: number;
  uv: number;
  refund: number;
}

/** 搜索关键词明细 */
export interface KeywordMetric {
  date: DateStr;
  keyword: string;
  /** 该词带来的访客数 */
  uv: number;
  gmv: number;
  orders: number;
}

/** 目标周期。季度和半年由月度目标累加得出，不单独填 */
export type TargetPeriod = 'month' | 'year';

export interface Target {
  period: TargetPeriod;
  /** 月度填 `2026-08`，年度填 `2026` */
  key: string;
  /** GMV 目标（元） */
  gmv: number;
  /** 主机销量目标（台） */
  deviceSales: number;
}

/** 一次同步落下来的完整数据快照 */
export interface DashboardSnapshot {
  source: 'feishu-bitable' | 'feishu-sheets' | 'mock';
  /** 同步完成时间，ISO 字符串 */
  syncedAt: string;
  coverage: DateRange;
  daily: DailyMetric[];
  ads: AdMetric[];
  products: ProductMetric[];
  keywords: KeywordMetric[];
  targets: Target[];
  /** 同步过程中的告警，展示在看板顶部 */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// 展示层
// ---------------------------------------------------------------------------

/**
 * 对比口径。
 *
 * 昨日比前日、MTD 比上月同期、全年累计比去年同期 —— 三种都是「和上一个可比周期比」，
 * 但可比周期怎么取完全不同，所以口径要跟着数字一起显示，不能只写「环比」。
 */
export type PeriodKey = 'yesterday' | 'mtd' | 'ytd' | 'custom';

export interface Period {
  key: PeriodKey;
  /** 「昨日」「本月 MTD」 */
  label: string;
  /** 「环比前日」「环比前月」「环比前年」 */
  compareLabel: string;
  range: DateRange;
  /** 无可比区间（数据不够早）时为 null，页面上显示「无数据」 */
  compareRange: DateRange | null;
}

export type ValueFormat = 'currency' | 'integer' | 'percent' | 'decimal' | 'multiple';

/** 单个 KPI 的取值与对比 */
export interface KpiValue {
  key: string;
  label: string;
  value: number;
  format: ValueFormat;
  /** 相对可比周期的变化率；null 表示没有可比数据 */
  delta: number | null;
  /** 指标上升是否算好事（退款率上升是坏事） */
  higherIsBetter: boolean;
  /** 走势，用于 sparkline；不是每个 KPI 都有 */
  trend?: number[];
  /** 补充说明，如「较目标少 12 万」 */
  note?: string;
}

/** 聚合后的店铺指标。比率字段全部是「先汇总再相除」的结果 */
export interface Aggregate {
  days: number;
  gmv: number;
  deviceSales: number;
  gmvAfterRefund: number;
  refund: number;
  uv: number;
  searchUv: number;
  buyers: number;
  orders: number;
  addToCart: number;
  newCustomerGmv: number;
  adCost: number;
  adCostInsite: number;
  adCostOffsite: number;
  adGmv: number;
  adGmvInsite: number;
  adGmvOffsite: number;
  // --- 派生比率 ---
  /** 退款率 = 退款金额 ÷ GMV */
  refundRate: number;
  /** 投放费率 = 投放费 ÷ GMV */
  adCostRate: number;
  /** 站内投放费率 */
  adCostRateInsite: number;
  /** 站外投放费率 */
  adCostRateOffsite: number;
  /** 支付转化率 = 支付人数 ÷ UV */
  conversionRate: number;
  /** 客单价 = GMV ÷ 支付人数 */
  aov: number;
  /** UV 价值 = GMV ÷ UV */
  uvValue: number;
  /** 新客率 = 新客成交 ÷ GMV */
  newCustomerRate: number;
  /** 搜索 UV 占比 */
  searchUvShare: number;
  /** 综合 ROI = 投放成交 ÷ 投放费 */
  roi: number;
  roiInsite: number;
  roiOffsite: number;
}

/** 目标达成进度 */
export interface GoalProgress {
  key: string;
  /** 「本月」「Q3」「H2」「全年」 */
  label: string;
  /** 口径说明，如「2026 年 8 月」 */
  scope: string;
  gmvActual: number;
  gmvTarget: number;
  deviceActual: number;
  deviceTarget: number;
  /** 时间进度：已过天数 ÷ 总天数。用来判断是超前还是落后 */
  timeProgress: number;
  /** 该周期是否已经结束 */
  finished: boolean;
}
