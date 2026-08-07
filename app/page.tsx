import { Suspense } from 'react';
import { AdsSection } from '@/components/sections/AdsSection';
import { GoalAttainment } from '@/components/sections/GoalAttainment';
import { ProductSection } from '@/components/sections/ProductSection';
import { StoreOverview } from '@/components/sections/StoreOverview';
import { TrafficSection } from '@/components/sections/TrafficSection';
import { Card } from '@/components/ui/Card';
import { CustomRange } from '@/components/ui/CustomRange';
import { DataSourceBanner } from '@/components/ui/DataSourceBanner';
import { SectionNav } from '@/components/ui/SectionNav';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { getSnapshot } from '@/lib/data/source';
import { formatDateCn } from '@/lib/format';
import { buildView, parseCustomRange } from '@/lib/metrics';

// 每小时最多重新取一次数；数据本身一天只更新一次，没必要每个请求都算
export const revalidate = 3600;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const custom = parseCustomRange(params.from, params.to);

  const snapshot = await getSnapshot();
  const view = buildView(snapshot, custom);

  const trendHint = `${view.trendRange.from} 至 ${view.trendRange.to}${
    custom ? '（自定义区间）' : '（近 90 天）'
  }`;

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">天猫数据看板</h1>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              数据截至 {formatDateCn(view.latestDate)}（天猫 T+1 出数，「昨日」即数据最后一天）
            </p>
          </div>
          <ThemeToggle />
        </div>

        <div className="mt-4">
          <DataSourceBanner snapshot={snapshot} />
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <SectionNav />
          <Suspense fallback={<div className="h-8" />}>
            <CustomRange value={custom} min={view.earliestDate} max={view.latestDate} />
          </Suspense>
        </div>

        {custom && (
          <p className="mt-2 text-[11px] text-[var(--text-muted)]">
            已启用自定义区间：各板块会额外多出一档「自定义」，投放 / 产品 / 流量的拆解也切到这个区间。
          </p>
        )}
      </header>

      <div className="dashboard-content space-y-12">
        <GoalAttainment goals={view.goals} />

        <StoreOverview stats={view.stats} trend={view.trend} trendHint={trendHint} />

        <AdsSection
          scope="insite"
          stats={view.stats}
          rows={view.insite}
          trend={view.trend}
          trendHint={trendHint}
          breakdownPeriod={view.breakdownPeriod}
        />

        <AdsSection
          scope="offsite"
          stats={view.stats}
          rows={view.offsite}
          trend={view.trend}
          trendHint={trendHint}
          breakdownPeriod={view.breakdownPeriod}
        />

        <ProductSection
          lines={view.products.lines}
          items={view.products.items}
          period={view.breakdownPeriod}
        />

        <TrafficSection
          stats={view.stats}
          keywords={view.keywords}
          trend={view.trend}
          trendHint={trendHint}
          period={view.breakdownPeriod}
        />

        <Card title="口径说明" hint="数字对不上时先看这里">
          <ul className="space-y-1.5 text-xs text-[var(--text-secondary)]">
            <li>· 昨日比前一天；本月 MTD 比<strong>上月同期</strong>（1 号到同一个日号），不是整个上月。</li>
            <li>· 全年累计比去年同期（1 月 1 日到去年的同一天）。去年没有数据时显示「无数据」，不显示 0%。</li>
            <li>· 所有比率都是区间内先汇总再相除。先算每日比率再取平均是错的，那会给成交 3 万和 300 万的日子同样的权重。</li>
            <li>· 投放 / 产品 / 流量的拆解默认按本月 MTD 口径 —— 昨日一天的样本太小，排出来的榜每天都在抖。</li>
            <li>· 目标达成里的竖线是「计划进度」，按月度目标分布加权而非日历天数 —— 下半年的量压在双 11 上，按天数算会把正常的 8 月误判成落后。</li>
            <li>· 每张图都有数据表孪生体，数值可直接复制核对。绝不用双轴。</li>
          </ul>
        </Card>
      </div>

      <footer
        className="mt-12 border-t pt-4 text-[11px] text-[var(--text-muted)]"
        style={{ borderColor: 'var(--border)' }}
      >
        数据源：飞书电子表格 · 每日 09:30 自动同步
      </footer>
    </main>
  );
}
