'use client';

import { BarRanking } from '@/components/charts/BarRanking';
import { ShareBar } from '@/components/charts/ShareBar';
import { Card, SectionHeading } from '@/components/ui/Card';
import { TableView } from '@/components/ui/TableView';
import { formatCurrency, formatDecimal, formatExact, formatPercent } from '@/lib/format';
import type { CategorySummary, ProductSummary } from '@/lib/metrics';

const CATEGORY_COLORS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
];

/** 售罄天数分级：低于 14 天要补货，高于 90 天是积压 */
function stockState(days: number | null): { label: string; color: string; icon: string } {
  if (days === null) return { label: '无动销', color: 'var(--text-muted)', icon: '·' };
  if (days < 7) return { label: '断货风险', color: 'var(--status-critical)', icon: '▲' };
  if (days < 14) return { label: '需补货', color: 'var(--status-serious)', icon: '▲' };
  if (days > 90) return { label: '库存积压', color: 'var(--status-warning)', icon: '■' };
  return { label: '健康', color: 'var(--status-good)', icon: '●' };
}

/**
 * 商品分析：哪些单品在扛量、类目结构是否健康、谁快断货了。
 */
export function ProductAnalysis({
  products,
  categories,
}: {
  products: ProductSummary[];
  categories: CategorySummary[];
}) {
  const top = products.slice(0, 10);
  const risky = products.filter((product) => {
    const state = stockState(product.daysOfCover);
    return state.label === '断货风险' || state.label === '需补货';
  });

  return (
    <section aria-labelledby="product-analysis">
      <SectionHeading
        id="product-analysis"
        title="商品分析"
        description="单品成交排行、类目结构与库存周转，定位主推款和需要补货的 SKU。"
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card title="单品支付金额 Top 10" hint="悬停查看该单品的销量与转化率">
          <BarRanking
            rows={top.map((product) => ({
              key: product.itemId,
              label: product.title,
              value: product.gmv,
              detail: `销量 ${formatExact(product.quantity, 'integer')} 件 · 转化率 ${formatPercent(product.conversion, 2)} · 占比 ${formatPercent(product.gmvShare, 1)}`,
            }))}
            formatValue={formatCurrency}
            labelWidth={200}
          />
        </Card>

        <Card title="类目结构" hint="按支付金额占比，窄段的具体数值见数据表">
          <ShareBar
            segments={categories.map((category, index) => ({
              key: category.category,
              name: category.category,
              value: category.gmv,
              color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
            }))}
            formatValue={formatCurrency}
          />

          <div className="mt-5 space-y-2">
            {categories.map((category) => (
              <div key={category.category} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="text-[var(--text-secondary)]">{category.category}</span>
                <span className="tabular text-[var(--text-primary)]">
                  {formatCurrency(category.gmv)}
                  <span className="ml-2 text-[var(--text-muted)]">{formatPercent(category.share, 1)}</span>
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-4" title="商品明细" hint="售罄天数 = 期末库存 ÷ 区间日均销量">
        {risky.length > 0 && (
          <p className="mb-3 rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--hover-wash)' }}>
            <span aria-hidden style={{ color: 'var(--status-critical)' }}>
              ▲
            </span>{' '}
            <span className="text-[var(--text-primary)]">
              {risky.length} 个 SKU 库存不足两周
            </span>
            <span className="text-[var(--text-muted)]">
              ：{risky.slice(0, 3).map((product) => product.title).join('、')}
              {risky.length > 3 ? ' 等' : ''}
            </span>
          </p>
        )}

        <TableView
          caption="商品明细数据表"
          defaultOpen
          columns={[
            { key: 'title', header: '商品', render: (row: ProductSummary) => row.title },
            { key: 'category', header: '类目', render: (row) => row.category },
            { key: 'gmv', header: '支付金额', numeric: true, render: (row) => formatExact(row.gmv, 'currency') },
            { key: 'share', header: '占比', numeric: true, render: (row) => formatPercent(row.gmvShare, 1) },
            { key: 'quantity', header: '销量', numeric: true, render: (row) => formatExact(row.quantity, 'integer') },
            { key: 'uv', header: '访客数', numeric: true, render: (row) => formatExact(row.uv, 'integer') },
            { key: 'conversion', header: '转化率', numeric: true, render: (row) => formatPercent(row.conversion, 2) },
            { key: 'stock', header: '库存', numeric: true, render: (row) => formatExact(row.stock, 'integer') },
            {
              key: 'cover',
              header: '售罄天数',
              numeric: true,
              render: (row) => (row.daysOfCover === null ? '—' : formatDecimal(row.daysOfCover, 0)),
            },
            {
              key: 'state',
              header: '库存状态',
              // 状态永远配图标 + 文案，颜色只是第三重线索
              render: (row) => {
                const state = stockState(row.daysOfCover);
                return `${state.icon} ${state.label}`;
              },
              color: (row) => stockState(row.daysOfCover).color,
            },
          ]}
          rows={products}
        />
      </Card>
    </section>
  );
}
