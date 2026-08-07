/**
 * 天猫数据看板 —— 统一数据模型
 *
 * 所有数据源（飞书多维表格 / 飞书电子表格 / mock）最终都归一化成这里的结构，
 * 上层组件只认这些类型，换数据源不需要改 UI。
 */

/** 日期字符串，格式 YYYY-MM-DD */
export type DateStr = string;

/** 每日核心经营指标：飞书日报表的一行 */
export interface DailyMetric {
  date: DateStr;
  /** 支付金额（元） */
  gmv: number;
  /** 支付订单数 */
  orders: number;
  /** 支付买家数 */
  buyers: number;
  /** 访客数 UV */
  uv: number;
  /** 浏览量 PV */
  pv: number;
  /** 加购件数 */
  addToCart: number;
  /** 收藏数 */
  favorites: number;
  /** 退款金额（元） */
  refund: number;
  /** 推广花费（元，直通车 / 万相台 / 引力魔方合计） */
  adCost: number;
}

/** 流量渠道明细：某天某个渠道带来的访客与成交 */
export interface ChannelMetric {
  date: DateStr;
  /** 渠道名，如「手淘搜索」「直通车」「推荐流量」 */
  channel: string;
  uv: number;
  gmv: number;
  orders: number;
}

/** 商品维度明细 */
export interface ProductMetric {
  date: DateStr;
  /** 商品 ID（宝贝 ID） */
  itemId: string;
  title: string;
  /** 类目，用于分组 */
  category: string;
  gmv: number;
  /** 销量（件） */
  quantity: number;
  uv: number;
  /** 期末库存（件） */
  stock: number;
}

/** 营销活动 */
export interface CampaignMetric {
  /** 活动名，如「618 预售」「双11 现货」 */
  name: string;
  startDate: DateStr;
  endDate: DateStr;
  gmv: number;
  orders: number;
  uv: number;
  /** 活动投入（元） */
  cost: number;
  /** 优惠券核销金额（元） */
  couponRedeemed: number;
  /** 玩法类型 */
  type: '大促' | '日常活动' | '直播' | '短视频';
}

/** 一次同步落下来的完整数据快照 */
export interface DashboardSnapshot {
  /** 数据实际来源 */
  source: 'feishu-bitable' | 'feishu-sheets' | 'mock';
  /** 同步完成时间，ISO 字符串 */
  syncedAt: string;
  /** 数据覆盖的日期区间 */
  coverage: { from: DateStr; to: DateStr };
  daily: DailyMetric[];
  channels: ChannelMetric[];
  products: ProductMetric[];
  campaigns: CampaignMetric[];
  /** 同步过程中的告警（字段缺失、行解析失败等），会展示在看板顶部 */
  warnings: string[];
}

/** 日期区间预设 */
export type RangePreset = '7d' | '30d' | '90d' | 'mtd';

export interface DateRange {
  from: DateStr;
  to: DateStr;
}

/** 单个 KPI 的取值与对比 */
export interface KpiValue {
  key: string;
  label: string;
  value: number;
  /** 展示格式 */
  format: 'currency' | 'integer' | 'percent' | 'decimal';
  /** 环比（对比上一个等长周期）变化率，null 表示无可比数据 */
  wow: number | null;
  /** 同比（对比去年同期）变化率，null 表示无可比数据 */
  yoy: number | null;
  /** 指标上升是否算好事（退款额上升是坏事） */
  higherIsBetter: boolean;
  /** 12 点走势，用于 sparkline */
  trend: number[];
}
