'use client';

import { BarRanking } from '@/components/charts/BarRanking';
import { FunnelChart } from '@/components/charts/FunnelChart';
import { StackedColumnChart } from '@/components/charts/StackedColumnChart';
import { Card, SectionHeading } from '@/components/ui/Card';
import { StatTile } from '@/components/ui/StatTile';
import { TableView } from '@/components/ui/TableView';
import {
  formatCurrency,
  formatDateCn,
  formatDayShort,
  formatExact,
  formatInteger,
  formatPercent,
} from '@/lib/format';
import type { ChannelSummary, FunnelStage, channelStack } from '@/lib/metrics';
import type { KpiValue } from '@/lib/types';

const STACK_COLORS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
];

/**
 * 流量与转化：人从哪来、在哪一步掉了、哪个渠道值得追加投入。
 */
export function TrafficConversion({
  kpis,
  funnel,
  channels,
  stack,
}: {
  kpis: KpiValue[];
  funnel: FunnelStage[];
  channels: ChannelSummary[];
  stack: ReturnType<typeof channelStack>;
}) {
  return (
    <section aria-labelledby="traffic-conversion">
      <SectionHeading
        id="traffic-conversion"
        title="流量与转化"
        description="访客规模、浏览深度与各环节转化，配合渠道结构判断增量从哪里来。"
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map((kpi) => (
          <StatTile key={kpi.key} kpi={kpi} />
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="转化漏斗" hint="访客 → 加购 → 支付买家，逐层留存；收藏是平行互动行为，单独看上方 KPI">
          <FunnelChart stages={funnel} />
          <TableView
            caption="转化漏斗数据表"
            columns={[
              { key: 'stage', header: '环节', render: (row: FunnelStage) => row.label },
              { key: 'value', header: '人数', numeric: true, render: (row) => formatExact(row.value, 'integer') },
              { key: 'step', header: '较上层', numeric: true, render: (row) => formatPercent(row.stepRate, 2) },
              { key: 'overall', header: '占访客', numeric: true, render: (row) => formatPercent(row.overallRate, 2) },
            ]}
            rows={funnel}
          />
        </Card>

        <Card title="渠道支付金额排行" hint="悬停查看该渠道的访客占比与自身转化率">
          <BarRanking
            rows={channels.slice(0, 8).map((channel) => ({
              key: channel.channel,
              label: channel.channel,
              value: channel.gmv,
              detail: `访客占比 ${formatPercent(channel.uvShare, 1)} · 渠道转化率 ${formatPercent(channel.conversion, 2)}`,
            }))}
            formatValue={formatCurrency}
            labelWidth={155}
          />
          <TableView
            caption="渠道明细数据表"
            columns={[
              { key: 'channel', header: '渠道', render: (row: ChannelSummary) => row.channel },
              { key: 'uv', header: '访客数', numeric: true, render: (row) => formatExact(row.uv, 'integer') },
              { key: 'uvShare', header: '访客占比', numeric: true, render: (row) => formatPercent(row.uvShare, 1) },
              { key: 'gmv', header: '支付金额', numeric: true, render: (row) => formatExact(row.gmv, 'currency') },
              { key: 'gmvShare', header: '金额占比', numeric: true, render: (row) => formatPercent(row.gmvShare, 1) },
              { key: 'conversion', header: '转化率', numeric: true, render: (row) => formatPercent(row.conversion, 2) },
            ]}
            rows={channels}
          />
        </Card>
      </div>

      <Card
        className="mt-4"
        title="渠道支付金额构成"
        hint={`每日各渠道成交叠加，Top ${Math.min(5, stack.channels.length)} 之外并入「其他」`}
      >
        <StackedColumnChart
          rows={stack.rows.map((row) => ({
            label: formatDayShort(row.date),
            fullLabel: formatDateCn(row.date),
            values: row.values,
          }))}
          seriesNames={stack.channels}
          colors={STACK_COLORS}
          formatValue={formatCurrency}
          formatTooltip={(value) => formatExact(value, 'currency')}
        />
        <TableView
          caption="渠道每日支付金额数据表"
          columns={[
            { key: 'date', header: '日期', render: (row: { date: string }) => row.date },
            ...stack.channels.map((name, index) => ({
              key: name,
              header: name,
              numeric: true,
              render: (row: { values: number[] }) => formatExact(row.values[index] ?? 0, 'currency'),
            })),
            {
              key: 'total',
              header: '合计',
              numeric: true,
              render: (row: { values: number[] }) =>
                formatExact(row.values.reduce((sum, value) => sum + value, 0), 'currency'),
            },
          ]}
          rows={stack.rows}
        />
      </Card>

      <p className="mt-2 text-[11px] text-[var(--text-muted)]">
        合计访客 {formatInteger(channels.reduce((sum, channel) => sum + channel.uv, 0))} 人次。
      </p>
    </section>
  );
}
