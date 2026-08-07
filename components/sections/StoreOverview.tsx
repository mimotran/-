'use client';

import { TrendPanel, type TrendOption } from '@/components/charts/TrendPanel';
import { Card, SectionHeading } from '@/components/ui/Card';
import { PeriodBlock } from '@/components/ui/PeriodBlock';
import type { PeriodStats, TrendPoint } from '@/lib/metrics';
import type { KpiValue } from '@/lib/types';

/** 昨日那一排卡片带 sparkline，取最近 14 天 —— 单看一天的数字没有上下文 */
const SPARK_DAYS = 14;

/** 核心 8 项每一项都要有 sparkline —— 少几个会让同一行的卡片高矮不一，看着像坏了 */
const SPARK_PICKERS: Record<string, (point: TrendPoint) => number> = {
  gmv: (p) => p.gmv,
  deviceSales: (p) => p.deviceSales,
  refund: (p) => p.refund,
  refundRate: (p) => p.refundRate,
  adCost: (p) => p.adCost,
  adCostRate: (p) => p.adCostRate,
  uv: (p) => p.uv,
  searchUv: (p) => p.searchUv,
};

function withTrend(kpis: KpiValue[], points: TrendPoint[]): KpiValue[] {
  const window = points.slice(-SPARK_DAYS);
  return kpis.map((kpi) => {
    const pick = SPARK_PICKERS[kpi.key];
    return pick ? { ...kpi, trend: window.map(pick) } : kpi;
  });
}

const TREND_OPTIONS: TrendOption[] = [
  {
    key: 'gmv',
    label: 'GMV',
    format: 'currency',
    series: [{ key: 'gmv', name: 'GMV', color: 'var(--series-1)', pick: (p) => p.gmv }],
  },
  {
    key: 'deviceSales',
    label: '主机销量',
    format: 'integer',
    series: [{ key: 'deviceSales', name: '主机销量', color: 'var(--series-3)', pick: (p) => p.deviceSales }],
  },
  {
    key: 'refundRate',
    label: '退款率',
    format: 'percent',
    series: [{ key: 'refundRate', name: '退款率', color: 'var(--series-2)', pick: (p) => p.refundRate }],
  },
];

/**
 * 店铺整体。
 *
 * 三档周期竖着堆：昨日（带 14 天 sparkline）→ 本月 MTD → 全年累计。
 * 每一档的对比口径不同，所以对比标签跟着每一档走，不在板块级统一写「环比」。
 */
export function StoreOverview({
  stats,
  trend,
  trendHint,
}: {
  stats: PeriodStats[];
  trend: TrendPoint[];
  trendHint: string;
}) {
  return (
    <section aria-labelledby="store-overview">
      <SectionHeading
        id="store-overview"
        title="店铺整体"
        description="核心 8 项指标直接展示，其余收在「展开其他指标」里。比率均为区间内先汇总再相除，不是每日比率的平均。"
      />

      <div className="space-y-5">
        {stats.map((stat, index) => (
          <PeriodBlock
            key={stat.period.key}
            period={stat.period}
            kpis={index === 0 ? withTrend(stat.core, trend) : stat.core}
            extra={stat.extra}
            dense={index > 0}
          />
        ))}

        <Card title="趋势" hint={trendHint}>
          <TrendPanel points={trend} options={TREND_OPTIONS} />
        </Card>
      </div>
    </section>
  );
}
