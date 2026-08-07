'use client';

import { BarRanking } from '@/components/charts/BarRanking';
import { TrendPanel, type TrendOption } from '@/components/charts/TrendPanel';
import { Card, SectionHeading } from '@/components/ui/Card';
import { PeriodBlock } from '@/components/ui/PeriodBlock';
import { Delta } from '@/components/ui/StatTile';
import { TableView } from '@/components/ui/TableView';
import { formatCurrency, formatInteger, formatMultiple, formatPercent } from '@/lib/format';
import type { AdChannelRow, PeriodStats, TrendPoint } from '@/lib/metrics';
import type { AdScope, Period } from '@/lib/types';

/**
 * 投放板块（站内 / 站外共用一套）。
 *
 * 头部三组指标（合计 / 站内 / 站外）两个板块都一样 —— 需求里这么定的，
 * 因为看站内的人也需要知道站内在总盘里占多少，光看站内自己的 ROI 会做出
 * 「加预算」的错误结论。差异只在下半部分的拆解维度：站内拆触点，站外拆渠道。
 */

const INSITE_TREND: TrendOption[] = [
  {
    key: 'cost',
    label: '投放费',
    format: 'currency',
    series: [
      { key: 'insite', name: '站内投放费', color: 'var(--series-1)', pick: (p) => p.adCostInsite },
      { key: 'offsite', name: '站外投放费', color: 'var(--series-2)', pick: (p) => p.adCostOffsite },
    ],
  },
  {
    key: 'roi',
    label: 'ROI',
    format: 'multiple',
    series: [
      { key: 'insite', name: '站内 ROI', color: 'var(--series-1)', pick: (p) => p.roiInsite },
      { key: 'offsite', name: '站外 ROI', color: 'var(--series-2)', pick: (p) => p.roiOffsite },
    ],
  },
  {
    key: 'gmv',
    label: '成交',
    format: 'currency',
    series: [
      { key: 'insite', name: '站内成交', color: 'var(--series-1)', pick: (p) => p.adGmvInsite },
      { key: 'offsite', name: '站外成交', color: 'var(--series-2)', pick: (p) => p.adGmvOffsite },
    ],
  },
];

export function AdsSection({
  scope,
  stats,
  rows,
  trend,
  trendHint,
  breakdownPeriod,
}: {
  scope: AdScope;
  stats: PeriodStats[];
  rows: AdChannelRow[];
  trend: TrendPoint[];
  trendHint: string;
  breakdownPeriod: Period;
}) {
  const isInsite = scope === 'insite';
  const id = isInsite ? 'insite-ads' : 'offsite-ads';
  const title = isInsite ? '站内投放' : '站外投放';
  const dimension = isInsite ? '触点' : '渠道';

  const rangeText =
    breakdownPeriod.range.from === breakdownPeriod.range.to
      ? breakdownPeriod.range.from
      : `${breakdownPeriod.range.from} 至 ${breakdownPeriod.range.to}`;

  return (
    <section aria-labelledby={id}>
      <SectionHeading
        id={id}
        title={title}
        description={`头部同时给出合计、站内、站外三组投放费与 ROI —— 只看${isInsite ? '站内' : '站外'}自己的 ROI 容易得出错误的加预算结论。分${dimension}明细按${breakdownPeriod.label}口径。`}
      />

      <div className="space-y-5">
        {stats.map((stat, index) => (
          <PeriodBlock
            key={stat.period.key}
            period={stat.period}
            kpis={stat.ads}
            columns={3}
            dense={index > 0}
          />
        ))}

        <Card
          title={`分${dimension}投放`}
          hint={`${breakdownPeriod.label}口径 · ${rangeText}｜条形按投放费排序，同一颜色不编码大小`}
        >
          {rows.length === 0 ? (
            <div
              className="flex h-32 items-center justify-center rounded-lg border border-dashed text-sm text-[var(--text-muted)]"
              style={{ borderColor: 'var(--border)' }}
            >
              当前区间没有{dimension}数据
            </div>
          ) : (
            <>
              <BarRanking
                rows={rows.map((row) => ({
                  key: row.channel,
                  label: row.channel,
                  value: row.cost,
                  detail: `ROI ${formatMultiple(row.roi)}｜成交 ${formatCurrency(row.gmv)}｜占比 ${formatPercent(row.costShare, 1)}`,
                }))}
                formatValue={formatCurrency}
              />

              {/* ROI 单独一列直标：它和投放费量纲不同，不能画进同一根轴 */}
              <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {rows.map((row) => (
                  <li
                    key={row.channel}
                    className="flex items-baseline justify-between gap-2 rounded-lg border px-3 py-2 text-xs"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <span className="truncate text-[var(--text-secondary)]">{row.channel}</span>
                    <span className="flex shrink-0 items-baseline gap-2">
                      <span className="tabular font-semibold text-[var(--text-primary)]">
                        ROI {formatMultiple(row.roi)}
                      </span>
                      <Delta label="费用" rate={row.costDelta} higherIsBetter={false} />
                    </span>
                  </li>
                ))}
              </ul>

              <TableView
                caption={`分${dimension}投放明细`}
                rows={rows}
                columns={[
                  { key: 'channel', header: dimension, render: (row) => row.channel },
                  { key: 'cost', header: '投放费', numeric: true, render: (row) => formatCurrency(row.cost) },
                  { key: 'share', header: '费用占比', numeric: true, render: (row) => formatPercent(row.costShare, 1) },
                  { key: 'gmv', header: '成交', numeric: true, render: (row) => formatCurrency(row.gmv) },
                  { key: 'roi', header: 'ROI', numeric: true, render: (row) => formatMultiple(row.roi) },
                  { key: 'impressions', header: '曝光', numeric: true, render: (row) => formatInteger(row.impressions) },
                  { key: 'clicks', header: '点击', numeric: true, render: (row) => formatInteger(row.clicks) },
                  { key: 'ctr', header: '点击率', numeric: true, render: (row) => formatPercent(row.ctr) },
                ]}
              />
            </>
          )}
        </Card>

        <Card title="趋势" hint={`${trendHint}｜切换指标查看投放费 / ROI / 成交`}>
          <TrendPanel points={trend} options={INSITE_TREND} />
        </Card>
      </div>
    </section>
  );
}
