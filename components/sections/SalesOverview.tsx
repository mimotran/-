'use client';

import { LineChart } from '@/components/charts/LineChart';
import { Card, SectionHeading } from '@/components/ui/Card';
import { HeroFigure } from '@/components/ui/HeroFigure';
import { StatTile } from '@/components/ui/StatTile';
import { TableView } from '@/components/ui/TableView';
import { formatCurrency, formatDateCn, formatDayShort, formatExact } from '@/lib/format';
import { RANGE_LABELS, type TrendPoint } from '@/lib/metrics';
import type { KpiValue, RangePreset } from '@/lib/types';

/**
 * 销售概览：一个头号数字 + 一排 KPI + 一张趋势图。
 *
 * 趋势图放本期和去年同期两条线，共用一根轴 —— 同一个指标、同一个量纲，
 * 才可以叠在一张图上。双轴是这类看板最常见的错误。
 */
export function SalesOverview({
  kpis,
  gmvTrend,
  preset,
}: {
  kpis: KpiValue[];
  gmvTrend: TrendPoint[];
  preset: RangePreset;
}) {
  const hero = kpis.find((kpi) => kpi.key === 'gmv');
  const rest = kpis.filter((kpi) => kpi.key !== 'gmv');
  const hasLastYear = gmvTrend.some((point) => point.lastYear !== null);

  return (
    <section aria-labelledby="sales-overview">
      <SectionHeading
        id="sales-overview"
        title="销售概览"
        description="成交大盘：金额、订单、买家、客单价与退款，全部对比上一等长周期和去年同期。"
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card>
          {hero ? <HeroFigure kpi={hero} rangeLabel={RANGE_LABELS[preset]} /> : null}
        </Card>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {rest.map((kpi) => (
            <StatTile key={kpi.key} kpi={kpi} />
          ))}
        </div>
      </div>

      <Card
        className="mt-4"
        title="支付金额日趋势"
        hint={hasLastYear ? '实线为本期，灰线为去年同期，同一根纵轴' : '暂无去年同期数据可对比'}
      >
        <LineChart
          labels={gmvTrend.map((point) => formatDayShort(point.date))}
          fullLabels={gmvTrend.map((point) => formatDateCn(point.date))}
          series={[
            {
              key: 'current',
              name: '本期支付金额',
              color: 'var(--series-1)',
              values: gmvTrend.map((point) => point.current),
            },
            ...(hasLastYear
              ? [
                  {
                    key: 'lastYear',
                    name: '去年同期',
                    color: 'var(--series-muted)',
                    muted: true,
                    values: gmvTrend.map((point) => point.lastYear),
                  },
                ]
              : []),
          ]}
          formatValue={formatCurrency}
          formatTooltip={(value) => formatExact(value, 'currency')}
        />

        <TableView
          caption="支付金额日趋势数据表"
          columns={[
            { key: 'date', header: '日期', render: (row: TrendPoint) => row.date },
            {
              key: 'current',
              header: '本期支付金额',
              numeric: true,
              render: (row: TrendPoint) => formatExact(row.current, 'currency'),
            },
            {
              key: 'lastYear',
              header: '去年同期',
              numeric: true,
              render: (row: TrendPoint) =>
                row.lastYear === null ? '—' : formatExact(row.lastYear, 'currency'),
            },
          ]}
          rows={gmvTrend}
        />
      </Card>
    </section>
  );
}
