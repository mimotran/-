'use client';

import { BarRanking } from '@/components/charts/BarRanking';
import { TrendPanel, type TrendOption } from '@/components/charts/TrendPanel';
import { Card, SectionHeading } from '@/components/ui/Card';
import { PeriodBlock } from '@/components/ui/PeriodBlock';
import { Delta } from '@/components/ui/StatTile';
import { TableView } from '@/components/ui/TableView';
import { formatCurrency, formatInteger, formatPercent } from '@/lib/format';
import type { TrafficChannelRow, PeriodStats, TrendPoint } from '@/lib/metrics';
import type { KpiValue, Period } from '@/lib/types';

const TRAFFIC_TREND: TrendOption[] = [
  {
    key: 'uv',
    label: 'UV',
    format: 'integer',
    series: [
      { key: 'uv', name: '总 UV', color: 'var(--series-1)', pick: (p) => p.uv },
      { key: 'searchUv', name: '搜索 UV', color: 'var(--series-3)', pick: (p) => p.searchUv },
    ],
  },
  {
    key: 'conversionRate',
    label: '支付转化率',
    format: 'percent',
    series: [
      { key: 'conversionRate', name: '支付转化率', color: 'var(--series-1)', pick: (p) => p.conversionRate },
    ],
  },
];

/** 流量板块的头部指标：从聚合值里另挑一组，不复用店铺整体那 8 项 */
function trafficKpis(stat: PeriodStats): KpiValue[] {
  const { aggregate: a } = stat;
  const prev = stat.core.find((kpi) => kpi.key === 'uv');
  return [
    { key: 'uv', label: 'UV', value: a.uv, format: 'integer', delta: prev?.delta ?? null, higherIsBetter: true },
    {
      key: 'searchUv',
      label: '搜索 UV',
      value: a.searchUv,
      format: 'integer',
      delta: stat.core.find((kpi) => kpi.key === 'searchUv')?.delta ?? null,
      higherIsBetter: true,
    },
    { key: 'searchUvShare', label: '搜索 UV 占比', value: a.searchUvShare, format: 'percent', delta: null, higherIsBetter: true },
    { key: 'conversionRate', label: '支付转化率', value: a.conversionRate, format: 'percent', delta: null, higherIsBetter: true },
    { key: 'uvValue', label: 'UV 价值', value: a.uvValue, format: 'decimal', delta: null, higherIsBetter: true },
    { key: 'addToCart', label: '加购人数', value: a.addToCart, format: 'integer', delta: null, higherIsBetter: true },
  ];
}

/**
 * 流量。
 *
 * 总览 → 搜索 UV → 搜索流量来源，从大盘一路下钻到具体的词。
 * 流量来源是唯一能直接指导投放动作的粒度，所以给到单词级的转化率。
 */
export function TrafficSection({
  stats,
  trafficChannels,
  trend,
  trendHint,
  period,
}: {
  stats: PeriodStats[];
  trafficChannels: TrafficChannelRow[];
  trend: TrendPoint[];
  trendHint: string;
  period: Period;
}) {
  const rangeText =
    period.range.from === period.range.to
      ? period.range.from
      : `${period.range.from} 至 ${period.range.to}`;

  const searchGmv = trafficChannels.reduce((sum, row) => sum + row.gmv, 0);

  return (
    <section aria-labelledby="traffic">
      <SectionHeading
        id="traffic"
        title="流量"
        description="总览、搜索 UV、搜索流量来源三层。流量来源数据来自飞书搜索流量来源表，是唯一能直接指导投放动作的粒度。"
      />

      <div className="space-y-5">
        {stats.map((stat, index) => (
          <PeriodBlock
            key={stat.period.key}
            period={stat.period}
            kpis={trafficKpis(stat)}
            columns={3}
            dense={index > 0}
          />
        ))}

        <Card title="流量趋势" hint={`${trendHint}｜总 UV 与搜索 UV 同轴可比，都是访客数`}>
          <TrendPanel points={trend} options={TRAFFIC_TREND} />
        </Card>

        <Card
          title="搜索流量来源"
          hint={`${period.label}口径 · ${rangeText}｜Top ${trafficChannels.length} 词，合计成交 ${formatCurrency(searchGmv)}`}
        >
          {trafficChannels.length === 0 ? (
            <div
              className="flex h-32 items-center justify-center rounded-lg border border-dashed text-sm text-[var(--text-muted)]"
              style={{ borderColor: 'var(--border)' }}
            >
              当前区间没有流量来源数据
            </div>
          ) : (
            <>
              <BarRanking
                rows={trafficChannels.map((row) => ({
                  key: row.channel,
                  label: row.channel,
                  value: row.uv,
                  detail: `成交 ${formatCurrency(row.gmv)}｜转化率 ${formatPercent(row.conversionRate)}｜占搜索 UV ${formatPercent(row.uvShare, 1)}`,
                }))}
                formatValue={formatInteger}
                labelWidth={140}
              />

              <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {trafficChannels.slice(0, 6).map((row) => (
                  <li
                    key={row.channel}
                    className="flex items-baseline justify-between gap-2 rounded-lg border px-3 py-2 text-xs"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <span className="truncate text-[var(--text-secondary)]">{row.channel}</span>
                    <span className="flex shrink-0 items-baseline gap-2">
                      <span className="tabular font-semibold text-[var(--text-primary)]">
                        {formatPercent(row.conversionRate)}
                      </span>
                      <Delta label="UV" rate={row.uvDelta} higherIsBetter />
                    </span>
                  </li>
                ))}
              </ul>

              <TableView
                caption="流量来源明细"
                rows={trafficChannels}
                defaultOpen
                columns={[
                  { key: 'channel', header: '流量来源', render: (row) => row.channel },
                  { key: 'uv', header: '访客数', numeric: true, render: (row) => formatInteger(row.uv) },
                  { key: 'share', header: '占比', numeric: true, render: (row) => formatPercent(row.uvShare, 1) },
                  { key: 'buyers', header: '支付人数', numeric: true, render: (row) => formatInteger(row.buyers) },
                  { key: 'conversionRate', header: '转化率', numeric: true, render: (row) => formatPercent(row.conversionRate) },
                  { key: 'gmv', header: '成交', numeric: true, render: (row) => formatCurrency(row.gmv) },
                ]}
              />
            </>
          )}
        </Card>
      </div>
    </section>
  );
}
