'use client';

import { BarRanking } from '@/components/charts/BarRanking';
import { ShareBar } from '@/components/charts/ShareBar';
import { Card, SectionHeading } from '@/components/ui/Card';
import { Delta } from '@/components/ui/StatTile';
import { TableView } from '@/components/ui/TableView';
import { formatCurrency, formatInteger, formatPercent } from '@/lib/format';
import type { LineRow, ProductRow } from '@/lib/metrics';
import type { Period } from '@/lib/types';

/** 产品线固定配色：身份识别，顺序永不循环 */
const LINE_COLORS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
];

/**
 * 产品。
 *
 * 先给产品线汇总（Pro / NotePin / NOTE / 会员 / 配件），再下钻到单链接。
 * 产品线顺序固定，不按大小排 —— 位置换来换去会让人误以为结构变了。
 */
export function ProductSection({
  lines,
  items,
  period,
}: {
  lines: LineRow[];
  items: ProductRow[];
  period: Period;
}) {
  const rangeText =
    period.range.from === period.range.to
      ? period.range.from
      : `${period.range.from} 至 ${period.range.to}`;

  const totalGmv = lines.reduce((sum, row) => sum + row.gmv, 0);
  const totalQuantity = lines.reduce((sum, row) => sum + row.quantity, 0);
  const totalRefund = lines.reduce((sum, row) => sum + row.refund, 0);

  return (
    <section aria-labelledby="product">
      <SectionHeading
        id="product"
        title="产品"
        description={`${period.label}口径 · ${rangeText}。先看产品线结构，再下钻到单链接。退款率按各自口径单独计算。`}
      />

      <div className="space-y-4">
        <Card title="产品线结构" hint={`合计 GMV ${formatCurrency(totalGmv)}｜销量 ${formatInteger(totalQuantity)} 件｜退款 ${formatCurrency(totalRefund)}`}>
          <ShareBar
            segments={lines.map((row, index) => ({
              key: row.line,
              name: row.label,
              value: row.gmv,
              color: LINE_COLORS[index % LINE_COLORS.length],
            }))}
            formatValue={formatCurrency}
          />

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {lines.map((row, index) => (
              <div
                key={row.line}
                className="rounded-xl border p-3"
                style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ background: LINE_COLORS[index % LINE_COLORS.length] }}
                  />
                  <span className="text-xs text-[var(--text-secondary)]">{row.label}</span>
                </div>
                <div className="mt-1 text-lg font-semibold leading-none text-[var(--text-primary)]">
                  {formatCurrency(row.gmv)}
                </div>
                <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                  占比 {formatPercent(row.gmvShare, 1)}｜销量 {formatInteger(row.quantity)}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px]">
                  <Delta label={period.compareLabel} rate={row.gmvDelta} higherIsBetter />
                </div>
                <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                  退款率 {formatPercent(row.refundRate, 1)}
                </div>
              </div>
            ))}
          </div>

          <TableView
            caption="产品线明细"
            rows={lines}
            columns={[
              { key: 'label', header: '产品线', render: (row) => row.label },
              { key: 'gmv', header: 'GMV', numeric: true, render: (row) => formatCurrency(row.gmv) },
              { key: 'share', header: '占比', numeric: true, render: (row) => formatPercent(row.gmvShare, 1) },
              { key: 'quantity', header: '销量', numeric: true, render: (row) => formatInteger(row.quantity) },
              { key: 'uv', header: 'UV', numeric: true, render: (row) => formatInteger(row.uv) },
              { key: 'refund', header: '退款金额', numeric: true, render: (row) => formatCurrency(row.refund) },
              { key: 'refundRate', header: '退款率', numeric: true, render: (row) => formatPercent(row.refundRate, 1) },
            ]}
          />
        </Card>

        <Card title="单链接排行" hint="按 GMV 排序｜名义类目统一用一个颜色，长度已经编码了大小">
          <BarRanking
            rows={items.map((row) => ({
              key: row.itemId,
              label: row.title,
              value: row.gmv,
              detail: `销量 ${formatInteger(row.quantity)}｜客单价 ${formatCurrency(row.price)}｜退款率 ${formatPercent(row.refundRate, 1)}`,
            }))}
            formatValue={formatCurrency}
            labelWidth={160}
          />

          <TableView
            caption="单链接明细"
            rows={items}
            defaultOpen
            columns={[
              { key: 'title', header: '商品', render: (row) => row.title },
              { key: 'itemId', header: '商品 ID', render: (row) => row.itemId },
              { key: 'gmv', header: 'GMV', numeric: true, render: (row) => formatCurrency(row.gmv) },
              { key: 'share', header: '占比', numeric: true, render: (row) => formatPercent(row.gmvShare, 1) },
              { key: 'quantity', header: '销量', numeric: true, render: (row) => formatInteger(row.quantity) },
              { key: 'price', header: '客单价', numeric: true, render: (row) => formatCurrency(row.price) },
              { key: 'uv', header: 'UV', numeric: true, render: (row) => formatInteger(row.uv) },
              { key: 'refundRate', header: '退款率', numeric: true, render: (row) => formatPercent(row.refundRate, 1) },
            ]}
          />
        </Card>
      </div>
    </section>
  );
}
