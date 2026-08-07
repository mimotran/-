import {
  addDays,
  addMonths,
  addYears,
  dayOfMonth,
  daysInMonth,
  diffDays,
  endOfMonth,
  halfOf,
  inRange,
  monthKey,
  quarterOf,
  rangeLength,
  startOfMonth,
  startOfYear,
} from './dates';
import type {
  AdMetric,
  AdScope,
  Aggregate,
  DailyMetric,
  DashboardSnapshot,
  DateRange,
  DateStr,
  GoalProgress,
  KeywordMetric,
  KpiValue,
  Period,
  ProductLine,
  ProductMetric,
  Target,
  ValueFormat,
} from './types';

// ---------------------------------------------------------------------------
// 对比周期
// ---------------------------------------------------------------------------

/**
 * 三种「环比」取可比区间的方式完全不同，必须分开算：
 *   昨日 → 前一天
 *   本月 MTD → 上月同期（1 号到同一个日号，不是整个上月）
 *   全年累计 → 去年同期（1 月 1 日到去年的同一天）
 *
 * MTD 拿去比「整个上月」是最常见的错误：8 月 7 号的 7 天怎么比都比不过 7 月的 31 天，
 * 每个月前三周看起来都在暴跌。
 */
export function buildPeriods(
  latest: DateStr,
  earliest: DateStr,
  custom: DateRange | null,
): Period[] {
  const periods: Period[] = [];

  const clamp = (range: DateRange): DateRange | null =>
    range.to < earliest ? null : { from: range.from < earliest ? earliest : range.from, to: range.to };

  // 昨日：数据最后一天。天猫 T+1 出数，「最后一天」就是运营口中的昨天
  periods.push({
    key: 'yesterday',
    label: '昨日',
    compareLabel: '环比前日',
    range: { from: latest, to: latest },
    compareRange: clamp({ from: addDays(latest, -1), to: addDays(latest, -1) }),
  });

  // 本月 MTD vs 上月同期
  const mtdFrom = startOfMonth(latest);
  const prevMonthSameDay = addMonths(latest, -1);
  periods.push({
    key: 'mtd',
    label: '本月 MTD',
    compareLabel: '环比前月',
    range: { from: mtdFrom, to: latest },
    compareRange: clamp({ from: startOfMonth(prevMonthSameDay), to: prevMonthSameDay }),
  });

  // 全年累计 vs 去年同期
  const lastYearSameDay = addYears(latest, -1);
  periods.push({
    key: 'ytd',
    label: '全年累计',
    compareLabel: '环比前年',
    range: { from: startOfYear(latest), to: latest },
    compareRange: clamp({ from: startOfYear(lastYearSameDay), to: lastYearSameDay }),
  });

  if (custom) {
    // 自定义区间对比紧邻的等长区间
    const length = rangeLength(custom);
    periods.push({
      key: 'custom',
      label: '自定义',
      compareLabel: '环比上一周期',
      range: custom,
      compareRange: clamp({
        from: addDays(custom.from, -length),
        to: addDays(custom.from, -1),
      }),
    });
  }

  return periods;
}

// ---------------------------------------------------------------------------
// 聚合
// ---------------------------------------------------------------------------

const ZERO: Aggregate = {
  days: 0,
  gmv: 0,
  deviceSales: 0,
  gmvAfterRefund: 0,
  refund: 0,
  uv: 0,
  searchUv: 0,
  buyers: 0,
  orders: 0,
  addToCart: 0,
  newCustomerGmv: 0,
  adCost: 0,
  adCostInsite: 0,
  adCostOffsite: 0,
  adGmv: 0,
  adGmvInsite: 0,
  adGmvOffsite: 0,
  refundRate: 0,
  adCostRate: 0,
  adCostRateInsite: 0,
  adCostRateOffsite: 0,
  conversionRate: 0,
  aov: 0,
  uvValue: 0,
  newCustomerRate: 0,
  searchUvShare: 0,
  roi: 0,
  roiInsite: 0,
  roiOffsite: 0,
};

function safeDiv(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/**
 * 把区间内的每日数据汇总成一个聚合值。
 *
 * 比率一律「先汇总再相除」。先算每日退款率再取平均是错的 ——
 * 那等于给成交 3 万的日子和成交 300 万的日子同样的权重。
 */
export function aggregateRange(daily: DailyMetric[], range: DateRange | null): Aggregate {
  if (!range) return { ...ZERO };

  const acc: Aggregate = { ...ZERO };
  for (const row of daily) {
    if (!inRange(row.date, range)) continue;
    acc.days += 1;
    acc.gmv += row.gmv;
    acc.deviceSales += row.deviceSales;
    acc.gmvAfterRefund += row.gmvAfterRefund;
    acc.refund += row.refund;
    acc.uv += row.uv;
    acc.searchUv += row.searchUv;
    acc.buyers += row.buyers;
    acc.orders += row.orders;
    acc.addToCart += row.addToCart;
    acc.newCustomerGmv += row.newCustomerGmv;
    acc.adCostInsite += row.adCostInsite;
    acc.adCostOffsite += row.adCostOffsite;
    acc.adGmvInsite += row.adGmvInsite;
    acc.adGmvOffsite += row.adGmvOffsite;
  }

  acc.adCost = acc.adCostInsite + acc.adCostOffsite;
  acc.adGmv = acc.adGmvInsite + acc.adGmvOffsite;

  acc.refundRate = safeDiv(acc.refund, acc.gmv);
  acc.adCostRate = safeDiv(acc.adCost, acc.gmv);
  acc.adCostRateInsite = safeDiv(acc.adCostInsite, acc.gmv);
  acc.adCostRateOffsite = safeDiv(acc.adCostOffsite, acc.gmv);
  acc.conversionRate = safeDiv(acc.buyers, acc.uv);
  acc.aov = safeDiv(acc.gmv, acc.buyers);
  acc.uvValue = safeDiv(acc.gmv, acc.uv);
  acc.newCustomerRate = safeDiv(acc.newCustomerGmv, acc.gmv);
  acc.searchUvShare = safeDiv(acc.searchUv, acc.uv);
  acc.roi = safeDiv(acc.adGmv, acc.adCost);
  acc.roiInsite = safeDiv(acc.adGmvInsite, acc.adCostInsite);
  acc.roiOffsite = safeDiv(acc.adGmvOffsite, acc.adCostOffsite);

  return acc;
}

/** 变化率。没有可比数据或基数为 0 时返回 null，页面上显示「无数据」而不是 0% */
export function delta(current: number, previous: number, hasCompare: boolean): number | null {
  if (!hasCompare || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

// ---------------------------------------------------------------------------
// KPI 组装
// ---------------------------------------------------------------------------

interface KpiSpec {
  key: string;
  label: string;
  pick: (agg: Aggregate) => number;
  format: ValueFormat;
  higherIsBetter: boolean;
}

/** 店铺核心指标：需求里点名要放在首屏的 8 项 */
const STORE_CORE: KpiSpec[] = [
  { key: 'gmv', label: 'GMV', pick: (a) => a.gmv, format: 'currency', higherIsBetter: true },
  { key: 'deviceSales', label: '主机销量', pick: (a) => a.deviceSales, format: 'integer', higherIsBetter: true },
  { key: 'refund', label: '退款金额', pick: (a) => a.refund, format: 'currency', higherIsBetter: false },
  { key: 'refundRate', label: '退款率', pick: (a) => a.refundRate, format: 'percent', higherIsBetter: false },
  { key: 'adCost', label: '投放费', pick: (a) => a.adCost, format: 'currency', higherIsBetter: false },
  { key: 'adCostRate', label: '投放费率', pick: (a) => a.adCostRate, format: 'percent', higherIsBetter: false },
  { key: 'uv', label: 'UV', pick: (a) => a.uv, format: 'integer', higherIsBetter: true },
  { key: 'searchUv', label: '搜索 UV', pick: (a) => a.searchUv, format: 'integer', higherIsBetter: true },
];

/** 次级指标：默认收在「展开更多」里，需要时再看 */
const STORE_EXTRA: KpiSpec[] = [
  { key: 'gmvAfterRefund', label: '退后 GMV', pick: (a) => a.gmvAfterRefund, format: 'currency', higherIsBetter: true },
  { key: 'buyers', label: '支付人数', pick: (a) => a.buyers, format: 'integer', higherIsBetter: true },
  { key: 'orders', label: '支付订单数', pick: (a) => a.orders, format: 'integer', higherIsBetter: true },
  { key: 'aov', label: '客单价', pick: (a) => a.aov, format: 'currency', higherIsBetter: true },
  { key: 'conversionRate', label: '支付转化率', pick: (a) => a.conversionRate, format: 'percent', higherIsBetter: true },
  { key: 'uvValue', label: 'UV 价值', pick: (a) => a.uvValue, format: 'decimal', higherIsBetter: true },
  { key: 'addToCart', label: '加购人数', pick: (a) => a.addToCart, format: 'integer', higherIsBetter: true },
  { key: 'newCustomerRate', label: '新客率', pick: (a) => a.newCustomerRate, format: 'percent', higherIsBetter: true },
];

/** 投放板块的头部指标：合计 / 站内 / 站外 各一组费用与 ROI */
const AD_KPIS: KpiSpec[] = [
  { key: 'adCost', label: '合计投放费', pick: (a) => a.adCost, format: 'currency', higherIsBetter: false },
  { key: 'roi', label: '合计 ROI', pick: (a) => a.roi, format: 'multiple', higherIsBetter: true },
  { key: 'adCostInsite', label: '站内投放费', pick: (a) => a.adCostInsite, format: 'currency', higherIsBetter: false },
  { key: 'roiInsite', label: '站内 ROI', pick: (a) => a.roiInsite, format: 'multiple', higherIsBetter: true },
  { key: 'adCostOffsite', label: '站外投放费', pick: (a) => a.adCostOffsite, format: 'currency', higherIsBetter: false },
  { key: 'roiOffsite', label: '站外 ROI', pick: (a) => a.roiOffsite, format: 'multiple', higherIsBetter: true },
];

function buildKpis(specs: KpiSpec[], current: Aggregate, previous: Aggregate, hasCompare: boolean): KpiValue[] {
  return specs.map((spec) => ({
    key: spec.key,
    label: spec.label,
    value: spec.pick(current),
    format: spec.format,
    delta: delta(spec.pick(current), spec.pick(previous), hasCompare),
    higherIsBetter: spec.higherIsBetter,
  }));
}

export interface PeriodStats {
  period: Period;
  core: KpiValue[];
  extra: KpiValue[];
  ads: KpiValue[];
  aggregate: Aggregate;
}

export function buildPeriodStats(daily: DailyMetric[], period: Period): PeriodStats {
  const current = aggregateRange(daily, period.range);
  const previous = aggregateRange(daily, period.compareRange);
  const hasCompare = period.compareRange !== null && previous.days > 0;

  return {
    period,
    aggregate: current,
    core: buildKpis(STORE_CORE, current, previous, hasCompare),
    extra: buildKpis(STORE_EXTRA, current, previous, hasCompare),
    ads: buildKpis(AD_KPIS, current, previous, hasCompare),
  };
}

// ---------------------------------------------------------------------------
// 目标达成
// ---------------------------------------------------------------------------

function monthTarget(targets: Target[], key: string): Target | undefined {
  return targets.find((t) => t.period === 'month' && t.key === key);
}

/** 把若干个月的目标按天摊到任意区间上，用于季度 / 半年 / 自定义 */
function proratedTarget(targets: Target[], range: DateRange): { gmv: number; deviceSales: number } {
  let gmv = 0;
  let deviceSales = 0;

  let cursor = startOfMonth(range.from);
  while (cursor <= range.to) {
    const key = monthKey(cursor);
    const target = monthTarget(targets, key);
    if (target) {
      const monthEnd = endOfMonth(cursor);
      const from = cursor > range.from ? cursor : range.from;
      const to = monthEnd < range.to ? monthEnd : range.to;
      const covered = diffDays(from, to) + 1;
      const total = daysInMonth(cursor);
      const ratio = covered / total;
      gmv += target.gmv * ratio;
      deviceSales += target.deviceSales * ratio;
    }
    cursor = addMonths(cursor, 1);
  }

  return { gmv, deviceSales };
}

/**
 * 计划进度：到今天为止，**按计划**本该完成整个周期的百分之多少。
 *
 * 不用「已过天数 ÷ 总天数」——那对电商是错的。下半年的目标有很大一块压在
 * 11 月的双 11 上，8 月初按日历算已经走了 20%，但按计划只该完成 16%，
 * 拿 20% 当基准会把一个正常的 8 月判成「落后」。
 *
 * 用月度目标的分布做权重，落在月内时再按天线性摊 —— 月内的粒度我们只有这么多。
 * 没有月度目标时退回按天算，并如实反映在文案里。
 */
function expectedProgress(targets: Target[], range: DateRange, latest: DateStr): number {
  const total = rangeLength(range);
  const elapsedDays = latest < range.from ? 0 : Math.min(total, diffDays(range.from, latest) + 1);
  if (total <= 0) return 0;
  if (elapsedDays >= total) return 1;
  if (elapsedDays <= 0) return 0;

  const whole = proratedTarget(targets, range).gmv;
  if (whole <= 0) return elapsedDays / total; // 没有月度目标，只能按天

  const done = proratedTarget(targets, {
    from: range.from,
    to: addDays(range.from, elapsedDays - 1),
  }).gmv;

  return Math.min(1, done / whole);
}

function progressOf(
  daily: DailyMetric[],
  targets: Target[],
  label: string,
  scope: string,
  key: string,
  range: DateRange,
  target: { gmv: number; deviceSales: number },
  latest: DateStr,
): GoalProgress {
  const actual = aggregateRange(daily, range);

  return {
    key,
    label,
    scope,
    gmvActual: actual.gmv,
    gmvTarget: target.gmv,
    deviceActual: actual.deviceSales,
    deviceTarget: target.deviceSales,
    timeProgress: expectedProgress(targets, range, latest),
    finished: latest >= range.to,
  };
}

/**
 * 五档达成进度：本月 / 本季 / 半年 / 全年 /（可选）自定义。
 *
 * 每一档都同时给「达成进度」和「时间进度」—— 只看达成率没法判断好坏，
 * 8 月 7 号完成 25% 是超前，12 月 20 号完成 90% 是落后。
 */
export function buildGoals(
  daily: DailyMetric[],
  targets: Target[],
  latest: DateStr,
  custom: DateRange | null,
): GoalProgress[] {
  const y = latest.slice(0, 4);
  const quarter = quarterOf(latest);
  const half = halfOf(latest);
  const goals: GoalProgress[] = [];

  // 本月
  const mKey = monthKey(latest);
  const mTarget = monthTarget(targets, mKey);
  if (mTarget) {
    goals.push(
      progressOf(
        daily,
        targets,
        '本月',
        `${Number(mKey.slice(5))} 月`,
        mKey,
        { from: startOfMonth(latest), to: endOfMonth(latest) },
        mTarget,
        latest,
      ),
    );
  }

  // 本季
  const qFrom = `${y}-${String((quarter - 1) * 3 + 1).padStart(2, '0')}-01`;
  const qRange = { from: qFrom, to: endOfMonth(`${y}-${String(quarter * 3).padStart(2, '0')}-01`) };
  goals.push(
    progressOf(daily, targets, `Q${quarter}`, `${quarter * 3 - 2}–${quarter * 3} 月`, `${y}-Q${quarter}`, qRange, proratedTarget(targets, qRange), latest),
  );

  // 半年
  const hRange =
    half === 1
      ? { from: `${y}-01-01`, to: `${y}-06-30` }
      : { from: `${y}-07-01`, to: `${y}-12-31` };
  goals.push(
    progressOf(daily, targets, `H${half}`, half === 1 ? '1–6 月' : '7–12 月', `${y}-H${half}`, hRange, proratedTarget(targets, hRange), latest),
  );

  // 全年：用显式的年度目标，不是月度之和 —— 年初定的年目标通常比月度加总更高
  const yearRange = { from: `${y}-01-01`, to: `${y}-12-31` };
  const yTarget = targets.find((t) => t.period === 'year' && t.key === y);
  goals.push(
    progressOf(daily, targets, '全年', `${y} 年`, y, yearRange, yTarget ?? proratedTarget(targets, yearRange), latest),
  );

  if (custom) {
    goals.push(
      progressOf(
        daily,
        targets,
        '自定义',
        `${custom.from} 至 ${custom.to}`,
        'custom',
        custom,
        proratedTarget(targets, custom),
        latest,
      ),
    );
  }

  return goals;
}

// ---------------------------------------------------------------------------
// 投放拆解
// ---------------------------------------------------------------------------

export interface AdChannelRow {
  channel: string;
  cost: number;
  gmv: number;
  roi: number;
  impressions: number;
  clicks: number;
  /** 点击率 */
  ctr: number;
  /** 占该 scope 总投放费的比例 */
  costShare: number;
  /** 相对可比周期的投放费变化 */
  costDelta: number | null;
}

/** 按触点 / 渠道拆解投放，倒序排列并算出占比 */
export function adBreakdown(
  ads: AdMetric[],
  scope: AdScope,
  range: DateRange,
  compareRange: DateRange | null,
): AdChannelRow[] {
  const current = new Map<string, { cost: number; gmv: number; impressions: number; clicks: number }>();
  const previous = new Map<string, number>();

  for (const row of ads) {
    if (row.scope !== scope) continue;
    if (inRange(row.date, range)) {
      const acc = current.get(row.channel) ?? { cost: 0, gmv: 0, impressions: 0, clicks: 0 };
      acc.cost += row.cost;
      acc.gmv += row.gmv;
      acc.impressions += row.impressions;
      acc.clicks += row.clicks;
      current.set(row.channel, acc);
    }
    if (compareRange && inRange(row.date, compareRange)) {
      previous.set(row.channel, (previous.get(row.channel) ?? 0) + row.cost);
    }
  }

  const totalCost = [...current.values()].reduce((sum, item) => sum + item.cost, 0);

  return [...current.entries()]
    .map(([channel, item]) => ({
      channel,
      cost: item.cost,
      gmv: item.gmv,
      roi: safeDiv(item.gmv, item.cost),
      impressions: item.impressions,
      clicks: item.clicks,
      ctr: safeDiv(item.clicks, item.impressions),
      costShare: safeDiv(item.cost, totalCost),
      costDelta: delta(item.cost, previous.get(channel) ?? 0, compareRange !== null && previous.has(channel)),
    }))
    .sort((a, b) => b.cost - a.cost);
}

// ---------------------------------------------------------------------------
// 产品
// ---------------------------------------------------------------------------

export const LINE_LABELS: Record<ProductLine, string> = {
  pro: 'NOTE Pro',
  pins: 'NotePin',
  note: 'NOTE',
  member: '会员',
  accessory: '配件',
};

export interface ProductRow {
  itemId: string;
  title: string;
  line: ProductLine;
  gmv: number;
  quantity: number;
  uv: number;
  refund: number;
  refundRate: number;
  /** 客单价 */
  price: number;
  gmvShare: number;
  gmvDelta: number | null;
}

export interface LineRow {
  line: ProductLine;
  label: string;
  gmv: number;
  quantity: number;
  uv: number;
  refund: number;
  refundRate: number;
  gmvShare: number;
  gmvDelta: number | null;
}

export function productBreakdown(
  products: ProductMetric[],
  range: DateRange,
  compareRange: DateRange | null,
): { lines: LineRow[]; items: ProductRow[] } {
  type Acc = { gmv: number; quantity: number; uv: number; refund: number };
  const blank = (): Acc => ({ gmv: 0, quantity: 0, uv: 0, refund: 0 });

  const byLine = new Map<ProductLine, Acc>();
  const byLinePrev = new Map<ProductLine, number>();
  const byItem = new Map<string, Acc & { title: string; line: ProductLine }>();
  const byItemPrev = new Map<string, number>();

  for (const row of products) {
    if (inRange(row.date, range)) {
      const line = byLine.get(row.line) ?? blank();
      line.gmv += row.gmv;
      line.quantity += row.quantity;
      line.uv += row.uv;
      line.refund += row.refund;
      byLine.set(row.line, line);

      const item = byItem.get(row.itemId) ?? { ...blank(), title: row.title, line: row.line };
      item.gmv += row.gmv;
      item.quantity += row.quantity;
      item.uv += row.uv;
      item.refund += row.refund;
      byItem.set(row.itemId, item);
    }
    if (compareRange && inRange(row.date, compareRange)) {
      byLinePrev.set(row.line, (byLinePrev.get(row.line) ?? 0) + row.gmv);
      byItemPrev.set(row.itemId, (byItemPrev.get(row.itemId) ?? 0) + row.gmv);
    }
  }

  const totalGmv = [...byLine.values()].reduce((sum, item) => sum + item.gmv, 0);
  const hasCompare = compareRange !== null;

  // 固定顺序，不按大小排 —— 产品线是身份，位置换来换去会让人以为结构变了
  const ORDER: ProductLine[] = ['pro', 'pins', 'note', 'member', 'accessory'];

  const lines: LineRow[] = ORDER.filter((line) => byLine.has(line)).map((line) => {
    const acc = byLine.get(line)!;
    return {
      line,
      label: LINE_LABELS[line],
      gmv: acc.gmv,
      quantity: acc.quantity,
      uv: acc.uv,
      refund: acc.refund,
      refundRate: safeDiv(acc.refund, acc.gmv),
      gmvShare: safeDiv(acc.gmv, totalGmv),
      gmvDelta: delta(acc.gmv, byLinePrev.get(line) ?? 0, hasCompare && byLinePrev.has(line)),
    };
  });

  const items: ProductRow[] = [...byItem.entries()]
    .map(([itemId, acc]) => ({
      itemId,
      title: acc.title,
      line: acc.line,
      gmv: acc.gmv,
      quantity: acc.quantity,
      uv: acc.uv,
      refund: acc.refund,
      refundRate: safeDiv(acc.refund, acc.gmv),
      price: safeDiv(acc.gmv, acc.quantity),
      gmvShare: safeDiv(acc.gmv, totalGmv),
      gmvDelta: delta(acc.gmv, byItemPrev.get(itemId) ?? 0, hasCompare && byItemPrev.has(itemId)),
    }))
    .sort((a, b) => b.gmv - a.gmv);

  return { lines, items };
}

// ---------------------------------------------------------------------------
// 搜索关键词
// ---------------------------------------------------------------------------

export interface KeywordRow {
  keyword: string;
  uv: number;
  gmv: number;
  orders: number;
  /** 该词的转化率 */
  conversionRate: number;
  uvShare: number;
  uvDelta: number | null;
}

export function keywordBreakdown(
  keywords: KeywordMetric[],
  range: DateRange,
  compareRange: DateRange | null,
  limit = 15,
): KeywordRow[] {
  const current = new Map<string, { uv: number; gmv: number; orders: number }>();
  const previous = new Map<string, number>();

  for (const row of keywords) {
    if (inRange(row.date, range)) {
      const acc = current.get(row.keyword) ?? { uv: 0, gmv: 0, orders: 0 };
      acc.uv += row.uv;
      acc.gmv += row.gmv;
      acc.orders += row.orders;
      current.set(row.keyword, acc);
    }
    if (compareRange && inRange(row.date, compareRange)) {
      previous.set(row.keyword, (previous.get(row.keyword) ?? 0) + row.uv);
    }
  }

  const totalUv = [...current.values()].reduce((sum, item) => sum + item.uv, 0);

  return [...current.entries()]
    .map(([keyword, acc]) => ({
      keyword,
      uv: acc.uv,
      gmv: acc.gmv,
      orders: acc.orders,
      conversionRate: safeDiv(acc.orders, acc.uv),
      uvShare: safeDiv(acc.uv, totalUv),
      uvDelta: delta(acc.uv, previous.get(keyword) ?? 0, compareRange !== null && previous.has(keyword)),
    }))
    .sort((a, b) => b.uv - a.uv)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// 趋势序列
// ---------------------------------------------------------------------------

export type TrendMetric =
  | 'gmv'
  | 'deviceSales'
  | 'refundRate'
  | 'adCost'
  | 'roi'
  | 'adGmv'
  | 'uv'
  | 'searchUv'
  | 'conversionRate';

export interface TrendPoint {
  date: DateStr;
  gmv: number;
  deviceSales: number;
  refund: number;
  refundRate: number;
  adCostRate: number;
  adCost: number;
  adCostInsite: number;
  adCostOffsite: number;
  roi: number;
  roiInsite: number;
  roiOffsite: number;
  adGmv: number;
  adGmvInsite: number;
  adGmvOffsite: number;
  uv: number;
  searchUv: number;
  conversionRate: number;
}

/** 逐日展开成趋势点。比率同样是当天「先汇总再相除」，只是汇总范围只有一天 */
export function buildTrend(daily: DailyMetric[], range: DateRange): TrendPoint[] {
  return daily
    .filter((row) => inRange(row.date, range))
    .map((row) => {
      const adCost = row.adCostInsite + row.adCostOffsite;
      const adGmv = row.adGmvInsite + row.adGmvOffsite;
      return {
        date: row.date,
        gmv: row.gmv,
        deviceSales: row.deviceSales,
        refund: row.refund,
        refundRate: safeDiv(row.refund, row.gmv),
        adCostRate: safeDiv(adCost, row.gmv),
        adCost,
        adCostInsite: row.adCostInsite,
        adCostOffsite: row.adCostOffsite,
        roi: safeDiv(adGmv, adCost),
        roiInsite: safeDiv(row.adGmvInsite, row.adCostInsite),
        roiOffsite: safeDiv(row.adGmvOffsite, row.adCostOffsite),
        adGmv,
        adGmvInsite: row.adGmvInsite,
        adGmvOffsite: row.adGmvOffsite,
        uv: row.uv,
        searchUv: row.searchUv,
        conversionRate: safeDiv(row.buyers, row.uv),
      };
    });
}

// ---------------------------------------------------------------------------
// 视图装配
// ---------------------------------------------------------------------------

export interface DashboardView {
  latestDate: DateStr;
  earliestDate: DateStr;
  periods: Period[];
  stats: PeriodStats[];
  goals: GoalProgress[];
  trend: TrendPoint[];
  trendRange: DateRange;
  insite: AdChannelRow[];
  offsite: AdChannelRow[];
  products: { lines: LineRow[]; items: ProductRow[] };
  keywords: KeywordRow[];
  /** 拆解板块（投放 / 产品 / 流量）用哪个周期的口径 */
  breakdownPeriod: Period;
}

/** 趋势图默认看多少天 */
const TREND_DAYS = 90;

export function buildView(snapshot: DashboardSnapshot, custom: DateRange | null): DashboardView {
  const daily = snapshot.daily;
  const latest = daily.length > 0 ? daily[daily.length - 1].date : snapshot.coverage.to;
  const earliest = daily.length > 0 ? daily[0].date : snapshot.coverage.from;

  const periods = buildPeriods(latest, earliest, custom);
  const stats = periods.map((period) => buildPeriodStats(daily, period));

  // 拆解类板块用自定义区间；没设自定义就用 MTD —— 昨日一天的明细样本太小，
  // 排出来的触点榜每天都在抖，看不出结构
  const breakdownPeriod = periods.find((p) => p.key === 'custom') ?? periods[1];

  const trendRange = custom ?? {
    from: (() => {
      const from = addDays(latest, -(TREND_DAYS - 1));
      return from < earliest ? earliest : from;
    })(),
    to: latest,
  };

  return {
    latestDate: latest,
    earliestDate: earliest,
    periods,
    stats,
    goals: buildGoals(daily, snapshot.targets, latest, custom),
    trend: buildTrend(daily, trendRange),
    trendRange,
    insite: adBreakdown(snapshot.ads, 'insite', breakdownPeriod.range, breakdownPeriod.compareRange),
    offsite: adBreakdown(snapshot.ads, 'offsite', breakdownPeriod.range, breakdownPeriod.compareRange),
    products: productBreakdown(snapshot.products, breakdownPeriod.range, breakdownPeriod.compareRange),
    keywords: keywordBreakdown(snapshot.keywords, breakdownPeriod.range, breakdownPeriod.compareRange),
    breakdownPeriod,
  };
}

/** 解析 URL 上的自定义区间。两个都在、格式对、顺序对，才算数 */
export function parseCustomRange(from?: string, to?: string): DateRange | null {
  const valid = (value?: string) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
  if (!valid(from) || !valid(to)) return null;
  return from! <= to! ? { from: from!, to: to! } : { from: to!, to: from! };
}

/** 天数差，给「自定义区间共 N 天」这类文案用 */
export { rangeLength, dayOfMonth };
