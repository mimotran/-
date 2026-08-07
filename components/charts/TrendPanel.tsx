'use client';

import { useState } from 'react';
import { LineChart } from '@/components/charts/LineChart';
import { TableView } from '@/components/ui/TableView';
import { formatByKind, formatDateCn, formatDayShort, formatExact } from '@/lib/format';
import type { TrendPoint } from '@/lib/metrics';
import type { ValueFormat } from '@/lib/types';

export interface TrendOption {
  key: string;
  label: string;
  format: ValueFormat;
  /** 每个系列取 TrendPoint 上的哪个字段 */
  series: Array<{ key: string; name: string; color: string; pick: (point: TrendPoint) => number }>;
}

/**
 * 可切换指标的趋势图。
 *
 * 一次只画一个指标 —— 投放费和 ROI 量纲差三个数量级，塞进一张图就得上双轴，
 * 而双轴的对齐方式是任意的，会凭空造出并不存在的相关性。切换比双轴诚实。
 */
export function TrendPanel({
  points,
  options,
  height = 260,
}: {
  points: TrendPoint[];
  options: TrendOption[];
  height?: number;
}) {
  const [activeKey, setActiveKey] = useState(options[0]?.key ?? '');
  const option = options.find((item) => item.key === activeKey) ?? options[0];

  if (!option || points.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-[var(--text-muted)]" style={{ borderColor: 'var(--border)' }}>
        当前区间没有数据
      </div>
    );
  }

  const labels = points.map((point) => formatDayShort(point.date));
  const fullLabels = points.map((point) => formatDateCn(point.date));

  return (
    <div>
      <div role="group" aria-label="趋势指标" className="mb-3 flex flex-wrap gap-1">
        {options.map((item) => {
          const selected = item.key === option.key;
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={selected}
              onClick={() => setActiveKey(item.key)}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                selected
                  ? 'font-semibold text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--hover-wash)]'
              }`}
              style={{
                borderColor: 'var(--border)',
                background: selected ? 'var(--hover-wash)' : 'transparent',
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <LineChart
        labels={labels}
        fullLabels={fullLabels}
        series={option.series.map((series) => ({
          key: series.key,
          name: series.name,
          color: series.color,
          values: points.map((point) => series.pick(point)),
        }))}
        formatValue={(value) => formatByKind(value, option.format)}
        formatTooltip={(value) => formatExact(value, option.format)}
        height={height}
      />

      <TableView
        caption={`${option.label}逐日明细`}
        rows={points}
        columns={[
          { key: 'date', header: '日期', render: (row) => row.date },
          ...option.series.map((series) => ({
            key: series.key,
            header: series.name,
            numeric: true,
            render: (row: TrendPoint) => formatExact(series.pick(row), option.format),
          })),
        ]}
      />
    </div>
  );
}
