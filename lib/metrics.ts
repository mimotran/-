import type {
  CampaignMetric,
  ChannelMetric,
  DailyMetric,
  DashboardSnapshot,
  DateRange,
  DateStr,
  KpiValue,
  ProductMetric,
  RangePreset,
} from './types';

/* ------------------------------------------------------------------ 日期 */

function shiftDate(date: DateStr, days: number): DateStr {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: DateStr, to: DateStr): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86400000) + 1;
}

/**
 * 预设区间统一以「数据最后一天」为终点，而不是今天 ——
 * 天猫数据 T+1 出，用今天当终点会永远少一天。
 */
export function resolveRange(preset: RangePreset, latest: DateStr): DateRange {
  switch (preset) {
    case '7d':
      return { from: shiftDate(latest, -6), to: latest };
    case '30d':
      return { from: shiftDate(latest, -29), to: latest };
    case '90d':
      return { from: shiftDate(latest, -89), to: latest };
    case 'mtd':
      return { from: `${latest.slice(0, 7)}-01`, to: latest };
  }
}

export const RANGE_LABELS: Record<RangePreset, string> = {
  '7d': '近 7 天',
  '30d': '近 30 天',
  '90d': '近 90 天',
  mtd: '本月至今',
};

/** 紧邻当前区间之前、等长的一段，用于环比 */
export function previousPeriod(range: DateRange): DateRange {
  const length = daysBetween(range.from, range.to);
  return { from: shiftDate(range.from, -length), to: shiftDate(range.from, -1) };
}

/** 去年同期，用于同比 */
export function lastYearPeriod(range: DateRange): DateRange {
  return { from: shiftDate(range.from, -365), to: shiftDate(range.to, -365) };
}

export function inRange<T extends { date: DateStr }>(rows: T[], range: DateRange): T[] {
  return rows.filter((row) => row.date >= range.from && row.date <= range.to);
}

/* ---------------------------------------------------------------- 聚合 */

export interface Totals {
  gmv: number;
  orders: number;
  buyers: number;
  uv: number;
  pv: number;
  addToCart: number;
  favorites: number;
  refund: number;
  adCost: number;
  /** 客单价 = 支付金额 / 支付买家数 */
  aov: number;
  /** 支付转化率 = 支付买家数 / 访客数 */
  conversion: number;
  /** 加购率 = 加购件数 / 访客数 */
  addToCartRate: number;
  /** 退款率 = 退款金额 / 支付金额 */
  refundRate: number;
  /** ROI = 支付金额 / 推广花费 */
  roi: number;
  /** 人均浏览深度 = 浏览量 / 访客数 */
  depth: number;
}

const EMPTY_SUM = {
  gmv: 0, orders: 0, buyers: 0, uv: 0, pv: 0,
  addToCart: 0, favorites: 0, refund: 0, adCost: 0,
};

export function aggregate(rows: DailyMetric[]): Totals {
  const sum = rows.reduce(
    (acc, row) => ({
      gmv: acc.gmv + row.gmv,
      orders: acc.orders + row.orders,
      buyers: acc.buyers + row.buyers,
      uv: acc.uv + row.uv,
      pv: acc.pv + row.pv,
      addToCart: acc.addToCart + row.addToCart,
      favorites: acc.favorites + row.favorites,
      refund: acc.refund + row.refund,
      adCost: acc.adCost + row.adCost,
    }),
    { ...EMPTY_SUM },
  );

  return {
    ...sum,
    aov: safeDiv(sum.gmv, sum.buyers),
    conversion: safeDiv(sum.buyers, sum.uv),
    addToCartRate: safeDiv(sum.addToCart, sum.uv),
    refundRate: safeDiv(sum.refund, sum.gmv),
    roi: safeDiv(sum.gmv, sum.adCost),
    depth: safeDiv(sum.pv, sum.uv),
  };
}

function safeDiv(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/** 变化率；基期为 0 时返回 null，页面上显示「—」而不是 +∞% */
export function changeRate(current: number, base: number): number | null {
  if (!Number.isFinite(base) || base === 0) return null;
  return (current - base) / base;
}

/* ------------------------------------------------------------------ KPI */

/** 把区间内的走势压缩成 12 个点，短区间按天、长区间按等宽分桶 */
export function sparkline(rows: DailyMetric[], field: keyof DailyMetric, buckets = 12): number[] {
  const values = rows.map((row) => Number(row[field]) || 0);
  if (values.length === 0) return new Array(buckets).fill(0);
  if (values.length <= buckets) return values;

  const size = values.length / buckets;
  return Array.from({ length: buckets }, (_, i) => {
    const slice = values.slice(Math.floor(i * size), Math.floor((i + 1) * size));
    return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
  });
}

interface KpiSpec {
  key: string;
  label: string;
  format: KpiValue['format'];
  higherIsBetter: boolean;
  read: (totals: Totals) => number;
  trendField: keyof DailyMetric;
}

const SALES_KPIS: KpiSpec[] = [
  { key: 'gmv', label: '支付金额', format: 'currency', higherIsBetter: true, read: (t) => t.gmv, trendField: 'gmv' },
  { key: 'orders', label: '支付订单数', format: 'integer', higherIsBetter: true, read: (t) => t.orders, trendField: 'orders' },
  { key: 'buyers', label: '支付买家数', format: 'integer', higherIsBetter: true, read: (t) => t.buyers, trendField: 'buyers' },
  { key: 'aov', label: '客单价', format: 'currency', higherIsBetter: true, read: (t) => t.aov, trendField: 'gmv' },
  { key: 'conversion', label: '支付转化率', format: 'percent', higherIsBetter: true, read: (t) => t.conversion, trendField: 'orders' },
  { key: 'refundRate', label: '退款率', format: 'percent', higherIsBetter: false, read: (t) => t.refundRate, trendField: 'refund' },
];

const TRAFFIC_KPIS: KpiSpec[] = [
  { key: 'uv', label: '访客数', format: 'integer', higherIsBetter: true, read: (t) => t.uv, trendField: 'uv' },
  { key: 'pv', label: '浏览量', format: 'integer', higherIsBetter: true, read: (t) => t.pv, trendField: 'pv' },
  { key: 'depth', label: '人均浏览深度', format: 'decimal', higherIsBetter: true, read: (t) => t.depth, trendField: 'pv' },
  { key: 'addToCartRate', label: '加购率', format: 'percent', higherIsBetter: true, read: (t) => t.addToCartRate, trendField: 'addToCart' },
  { key: 'favorites', label: '收藏人数', format: 'integer', higherIsBetter: true, read: (t) => t.favorites, trendField: 'favorites' },
  { key: 'roi', label: '推广 ROI', format: 'decimal', higherIsBetter: true, read: (t) => t.roi, trendField: 'adCost' },
];

function buildKpis(specs: KpiSpec[], daily: DailyMetric[], range: DateRange): KpiValue[] {
  const current = inRange(daily, range);
  const previous = inRange(daily, previousPeriod(range));
  const lastYear = inRange(daily, lastYearPeriod(range));

  const currentTotals = aggregate(current);
  const previousTotals = previous.length ? aggregate(previous) : null;
  const lastYearTotals = lastYear.length ? aggregate(lastYear) : null;

  return specs.map((spec) => ({
    key: spec.key,
    label: spec.label,
    format: spec.format,
    higherIsBetter: spec.higherIsBetter,
    value: spec.read(currentTotals),
    wow: previousTotals ? changeRate(spec.read(currentTotals), spec.read(previousTotals)) : null,
    yoy: lastYearTotals ? changeRate(spec.read(currentTotals), spec.read(lastYearTotals)) : null,
    trend: sparkline(current, spec.trendField),
  }));
}

export function salesKpis(daily: DailyMetric[], range: DateRange): KpiValue[] {
  return buildKpis(SALES_KPIS, daily, range);
}

export function trafficKpis(daily: DailyMetric[], range: DateRange): KpiValue[] {
  return buildKpis(TRAFFIC_KPIS, daily, range);
}

/* ------------------------------------------------------- 趋势 / 漏斗 / 渠道 */

export interface TrendPoint {
  date: DateStr;
  current: number;
  /** 去年同期同一天的值，没有则为 null */
  lastYear: number | null;
}

/** 当前区间的日趋势，并对齐去年同期（用于同一条时间轴上的两条线） */
export function dailyTrend(
  daily: DailyMetric[],
  range: DateRange,
  field: keyof DailyMetric,
): TrendPoint[] {
  const byDate = new Map(daily.map((row) => [row.date, row]));
  return inRange(daily, range).map((row) => {
    const lastYearRow = byDate.get(shiftDate(row.date, -365));
    return {
      date: row.date,
      current: Number(row[field]) || 0,
      lastYear: lastYearRow ? Number(lastYearRow[field]) || 0 : null,
    };
  });
}

export interface FunnelStage {
  label: string;
  value: number;
  /** 相对上一层的留存率 */
  stepRate: number;
  /** 相对第一层的整体留存率 */
  overallRate: number;
}

/**
 * 访客 → 加购 → 支付买家 的转化漏斗。
 *
 * 「收藏」不放进来 —— 它和加购是平行的互动行为，不是加购的下一步。
 * 串成一条会算出「加购到收藏留存 57%」这种没有含义的数字，
 * 收藏单独作为一个 KPI 看即可。
 */
export function conversionFunnel(totals: Totals): FunnelStage[] {
  const stages = [
    { label: '访客数', value: totals.uv },
    { label: '加购', value: totals.addToCart },
    { label: '支付买家', value: totals.buyers },
  ];
  const head = stages[0].value;
  return stages.map((stage, i) => ({
    ...stage,
    stepRate: i === 0 ? 1 : safeDiv(stage.value, stages[i - 1].value),
    overallRate: safeDiv(stage.value, head),
  }));
}

export interface ChannelSummary {
  channel: string;
  uv: number;
  gmv: number;
  orders: number;
  /** 该渠道访客占大盘比例 */
  uvShare: number;
  /** 该渠道支付金额占大盘比例 */
  gmvShare: number;
  /** 渠道自身的转化率 = 订单数 / 访客数 */
  conversion: number;
}

export function channelSummary(channels: ChannelMetric[], range: DateRange): ChannelSummary[] {
  const rows = inRange(channels, range);
  const grouped = new Map<string, { uv: number; gmv: number; orders: number }>();

  for (const row of rows) {
    const acc = grouped.get(row.channel) ?? { uv: 0, gmv: 0, orders: 0 };
    acc.uv += row.uv;
    acc.gmv += row.gmv;
    acc.orders += row.orders;
    grouped.set(row.channel, acc);
  }

  const totalUv = [...grouped.values()].reduce((sum, item) => sum + item.uv, 0);
  const totalGmv = [...grouped.values()].reduce((sum, item) => sum + item.gmv, 0);

  return [...grouped.entries()]
    .map(([channel, item]) => ({
      channel,
      ...item,
      uvShare: safeDiv(item.uv, totalUv),
      gmvShare: safeDiv(item.gmv, totalGmv),
      conversion: safeDiv(item.orders, item.uv),
    }))
    .sort((a, b) => b.gmv - a.gmv);
}

/** 渠道 GMV 的每日堆叠数据，只保留 Top N 渠道，其余并成「其他」 */
export function channelStack(
  channels: ChannelMetric[],
  range: DateRange,
  topN = 5,
): { channels: string[]; rows: Array<{ date: DateStr; values: number[] }> } {
  const summary = channelSummary(channels, range);
  const top = summary.slice(0, topN).map((item) => item.channel);
  const hasRest = summary.length > topN;
  const names = hasRest ? [...top, '其他'] : top;

  const byDate = new Map<DateStr, number[]>();
  for (const row of inRange(channels, range)) {
    const values = byDate.get(row.date) ?? new Array(names.length).fill(0);
    const index = top.indexOf(row.channel);
    values[index >= 0 ? index : names.length - 1] += row.gmv;
    byDate.set(row.date, values);
  }

  return {
    channels: names,
    rows: [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, values]) => ({ date, values })),
  };
}

/* ---------------------------------------------------------------- 商品 */

export interface ProductSummary {
  itemId: string;
  title: string;
  category: string;
  gmv: number;
  quantity: number;
  uv: number;
  /** 期末库存取区间内最后一天的值 */
  stock: number;
  /** 商品自身转化率 = 销量 / 访客数 */
  conversion: number;
  /** 售罄天数 = 库存 / 日均销量；库存为 0 或无销量时为 null */
  daysOfCover: number | null;
  gmvShare: number;
}

export function productSummary(products: ProductMetric[], range: DateRange): ProductSummary[] {
  const rows = inRange(products, range);
  const days = Math.max(1, daysBetween(range.from, range.to));
  const grouped = new Map<string, ProductSummary & { lastDate: DateStr }>();

  for (const row of rows) {
    const existing = grouped.get(row.itemId);
    if (existing) {
      existing.gmv += row.gmv;
      existing.quantity += row.quantity;
      existing.uv += row.uv;
      if (row.date >= existing.lastDate) {
        existing.stock = row.stock;
        existing.lastDate = row.date;
      }
    } else {
      grouped.set(row.itemId, {
        itemId: row.itemId,
        title: row.title,
        category: row.category,
        gmv: row.gmv,
        quantity: row.quantity,
        uv: row.uv,
        stock: row.stock,
        conversion: 0,
        daysOfCover: null,
        gmvShare: 0,
        lastDate: row.date,
      });
    }
  }

  const totalGmv = [...grouped.values()].reduce((sum, item) => sum + item.gmv, 0);

  return [...grouped.values()]
    .map(({ lastDate: _lastDate, ...item }) => {
      const dailyQuantity = item.quantity / days;
      return {
        ...item,
        conversion: safeDiv(item.quantity, item.uv),
        daysOfCover: dailyQuantity > 0 ? item.stock / dailyQuantity : null,
        gmvShare: safeDiv(item.gmv, totalGmv),
      };
    })
    .sort((a, b) => b.gmv - a.gmv);
}

export interface CategorySummary {
  category: string;
  gmv: number;
  quantity: number;
  share: number;
}

export function categorySummary(products: ProductMetric[], range: DateRange): CategorySummary[] {
  const grouped = new Map<string, { gmv: number; quantity: number }>();
  for (const row of inRange(products, range)) {
    const acc = grouped.get(row.category) ?? { gmv: 0, quantity: 0 };
    acc.gmv += row.gmv;
    acc.quantity += row.quantity;
    grouped.set(row.category, acc);
  }
  const total = [...grouped.values()].reduce((sum, item) => sum + item.gmv, 0);
  return [...grouped.entries()]
    .map(([category, item]) => ({ category, ...item, share: safeDiv(item.gmv, total) }))
    .sort((a, b) => b.gmv - a.gmv);
}

/* ---------------------------------------------------------------- 活动 */

export interface CampaignSummary extends CampaignMetric {
  days: number;
  /** 日均支付金额，用于跨长度活动的公平对比 */
  dailyGmv: number;
  roi: number;
  conversion: number;
  /** 券核销占支付金额比例 */
  couponShare: number;
  /** 相对活动前同等天数的日均 GMV 提升倍数 */
  lift: number | null;
}

export function campaignSummary(
  campaigns: CampaignMetric[],
  daily: DailyMetric[],
  limit = 8,
): CampaignSummary[] {
  const byDate = new Map(daily.map((row) => [row.date, row]));

  return campaigns
    .slice()
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
    .slice(0, limit)
    .map((campaign) => {
      const days = Math.max(1, daysBetween(campaign.startDate, campaign.endDate));
      const dailyGmv = campaign.gmv / days;

      // 活动前等长天数作为基线，衡量真实拉动
      let baselineSum = 0;
      let baselineDays = 0;
      for (let i = 1; i <= days; i++) {
        const row = byDate.get(shiftDate(campaign.startDate, -i));
        if (row) {
          baselineSum += row.gmv;
          baselineDays += 1;
        }
      }
      const baseline = baselineDays > 0 ? baselineSum / baselineDays : 0;

      return {
        ...campaign,
        days,
        dailyGmv,
        roi: safeDiv(campaign.gmv, campaign.cost),
        conversion: safeDiv(campaign.orders, campaign.uv),
        couponShare: safeDiv(campaign.couponRedeemed, campaign.gmv),
        lift: baseline > 0 ? dailyGmv / baseline : null,
      };
    })
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/* ------------------------------------------------------------ 顶层组装 */

export interface DashboardView {
  range: DateRange;
  preset: RangePreset;
  latestDate: DateStr;
  totals: Totals;
  salesKpis: KpiValue[];
  trafficKpis: KpiValue[];
  gmvTrend: TrendPoint[];
  uvTrend: TrendPoint[];
  funnel: FunnelStage[];
  channels: ChannelSummary[];
  channelStack: ReturnType<typeof channelStack>;
  products: ProductSummary[];
  categories: CategorySummary[];
  campaigns: CampaignSummary[];
}

export function buildView(snapshot: DashboardSnapshot, preset: RangePreset): DashboardView {
  const latestDate = snapshot.coverage.to;
  const range = resolveRange(preset, latestDate);
  const current = inRange(snapshot.daily, range);

  return {
    range,
    preset,
    latestDate,
    totals: aggregate(current),
    salesKpis: salesKpis(snapshot.daily, range),
    trafficKpis: trafficKpis(snapshot.daily, range),
    gmvTrend: dailyTrend(snapshot.daily, range, 'gmv'),
    uvTrend: dailyTrend(snapshot.daily, range, 'uv'),
    funnel: conversionFunnel(aggregate(current)),
    channels: channelSummary(snapshot.channels, range),
    channelStack: channelStack(snapshot.channels, range),
    products: productSummary(snapshot.products, range),
    categories: categorySummary(snapshot.products, range),
    campaigns: campaignSummary(snapshot.campaigns, snapshot.daily),
  };
}
