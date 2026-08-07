import { Suspense } from 'react';
import { CampaignMarketing } from '@/components/sections/CampaignMarketing';
import { ProductAnalysis } from '@/components/sections/ProductAnalysis';
import { SalesOverview } from '@/components/sections/SalesOverview';
import { TrafficConversion } from '@/components/sections/TrafficConversion';
import { DataSourceBanner } from '@/components/ui/DataSourceBanner';
import { RangeFilter } from '@/components/ui/RangeFilter';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { getSnapshot } from '@/lib/data/source';
import { formatDateCn } from '@/lib/format';
import { buildView, RANGE_LABELS } from '@/lib/metrics';
import type { RangePreset } from '@/lib/types';

// 每小时最多重新取一次数；数据本身一天只更新一次，没必要每个请求都算
export const revalidate = 3600;

const VALID_PRESETS: RangePreset[] = ['7d', '30d', '90d', 'mtd'];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const params = await searchParams;
  const preset = VALID_PRESETS.includes(params.range as RangePreset)
    ? (params.range as RangePreset)
    : '30d';

  const snapshot = await getSnapshot();
  const view = buildView(snapshot, preset);

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">天猫数据看板</h1>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              数据截至 {formatDateCn(view.latestDate)} · 当前口径 {RANGE_LABELS[preset]}（
              {view.range.from} 至 {view.range.to}）
            </p>
          </div>
          <ThemeToggle />
        </div>

        <div className="mt-4">
          <DataSourceBanner snapshot={snapshot} />
        </div>

        {/* 筛选器只有一行，放在所有内容之上，作用于整个页面 */}
        <div className="mt-4">
          <Suspense fallback={<div className="h-9" />}>
            <RangeFilter value={preset} />
          </Suspense>
        </div>
      </header>

      <div className="dashboard-content space-y-10">
        <SalesOverview kpis={view.salesKpis} gmvTrend={view.gmvTrend} preset={preset} />
        <TrafficConversion
          kpis={view.trafficKpis}
          funnel={view.funnel}
          channels={view.channels}
          stack={view.channelStack}
        />
        <ProductAnalysis products={view.products} categories={view.categories} />
        <CampaignMarketing campaigns={view.campaigns} />
      </div>

      <footer className="mt-12 border-t pt-4 text-[11px] text-[var(--text-muted)]" style={{ borderColor: 'var(--border)' }}>
        环比对比紧邻的等长周期，同比对比去年同期。所有图表都提供数据表视图，数值可直接复制核对。
      </footer>
    </main>
  );
}
