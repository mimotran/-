'use client';

import { BarRanking } from '@/components/charts/BarRanking';
import { Card, SectionHeading } from '@/components/ui/Card';
import { TableView } from '@/components/ui/TableView';
import { formatCurrency, formatDecimal, formatExact, formatPercent } from '@/lib/format';
import type { CampaignSummary } from '@/lib/metrics';

/**
 * 活动与营销。
 *
 * 活动长短不一，直接比总 GMV 会让「双11 现货 12 天」天然赢过「双12 三天」，
 * 所以横轴统一用**日均支付金额**。ROI、券核销这些量纲不同的指标不往同一根轴上塞，
 * 放进数据表 —— 双轴图会凭空造出并不存在的相关性。
 */
export function CampaignMarketing({ campaigns }: { campaigns: CampaignSummary[] }) {
  if (campaigns.length === 0) {
    return (
      <section aria-labelledby="campaign-marketing">
        <SectionHeading
          id="campaign-marketing"
          title="活动与营销"
          description="大促与日常活动的拉动效果、投产比和优惠券核销情况。"
        />
        <Card>
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">
            暂无活动数据。在飞书的活动表里补上「活动名称 / 开始日期 / 结束日期 / 支付金额」等列后，这里会自动出现。
          </p>
        </Card>
      </section>
    );
  }

  const best = campaigns.reduce((a, b) => (b.dailyGmv > a.dailyGmv ? b : a));

  return (
    <section aria-labelledby="campaign-marketing">
      <SectionHeading
        id="campaign-marketing"
        title="活动与营销"
        description="大促与日常活动的拉动效果、投产比和优惠券核销情况。"
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card
          title="活动日均支付金额"
          hint="按日均对比，避免长活动因为天数多而虚高"
        >
          <BarRanking
            rows={campaigns
              .slice()
              .sort((a, b) => b.dailyGmv - a.dailyGmv)
              .map((campaign) => ({
                key: campaign.name,
                label: campaign.name,
                value: campaign.dailyGmv,
                detail: `${campaign.days} 天 · ROI ${formatDecimal(campaign.roi, 1)} · ${
                  campaign.lift === null ? '无基线可比' : `较活动前 ${formatDecimal(campaign.lift, 1)} 倍`
                }`,
              }))}
            formatValue={formatCurrency}
            labelWidth={170}
          />
        </Card>

        <Card title="表现最好的活动" hint="按日均支付金额">
          <div className="text-xs text-[var(--text-secondary)]">{best.name}</div>
          <div className="mt-1 text-3xl font-semibold leading-none text-[var(--text-primary)]">
            {formatCurrency(best.dailyGmv)}
            <span className="ml-1.5 text-sm font-normal text-[var(--text-muted)]">/ 天</span>
          </div>

          <dl className="mt-5 space-y-2.5 text-xs">
            <Row label="活动周期" value={`${best.startDate} 至 ${best.endDate}（${best.days} 天）`} />
            <Row label="累计支付金额" value={formatExact(best.gmv, 'currency')} />
            <Row label="投产比 ROI" value={formatDecimal(best.roi, 2)} />
            <Row label="活动转化率" value={formatPercent(best.conversion, 2)} />
            <Row label="券核销占比" value={formatPercent(best.couponShare, 1)} />
            <Row
              label="较活动前拉动"
              value={best.lift === null ? '无基线可比' : `${formatDecimal(best.lift, 2)} 倍`}
            />
          </dl>
        </Card>
      </div>

      <Card className="mt-4" title="活动明细">
        <TableView
          caption="活动明细数据表"
          defaultOpen
          columns={[
            { key: 'name', header: '活动', render: (row: CampaignSummary) => row.name },
            { key: 'type', header: '类型', render: (row) => row.type },
            { key: 'period', header: '周期', render: (row) => `${row.startDate} ~ ${row.endDate}` },
            { key: 'days', header: '天数', numeric: true, render: (row) => String(row.days) },
            { key: 'gmv', header: '支付金额', numeric: true, render: (row) => formatExact(row.gmv, 'currency') },
            { key: 'dailyGmv', header: '日均金额', numeric: true, render: (row) => formatExact(row.dailyGmv, 'currency') },
            { key: 'orders', header: '订单数', numeric: true, render: (row) => formatExact(row.orders, 'integer') },
            { key: 'conversion', header: '转化率', numeric: true, render: (row) => formatPercent(row.conversion, 2) },
            { key: 'cost', header: '投入', numeric: true, render: (row) => formatExact(row.cost, 'currency') },
            { key: 'roi', header: 'ROI', numeric: true, render: (row) => formatDecimal(row.roi, 2) },
            { key: 'coupon', header: '券核销占比', numeric: true, render: (row) => formatPercent(row.couponShare, 1) },
            {
              key: 'lift',
              header: '较活动前',
              numeric: true,
              render: (row) => (row.lift === null ? '—' : `${formatDecimal(row.lift, 2)}×`),
            },
          ]}
          rows={campaigns}
        />
      </Card>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[var(--text-muted)]">{label}</dt>
      <dd className="tabular text-right text-[var(--text-primary)]">{value}</dd>
    </div>
  );
}
