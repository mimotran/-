'use client';

import { useId, useState } from 'react';
import type { KpiValue, Period } from '@/lib/types';
import { StatTile } from './StatTile';

/**
 * 一个周期的指标行：昨日 / 本月 MTD / 全年累计 各占一块。
 *
 * 三档周期堆着展示（而不是做成 tab 切换）是刻意的 —— 运营看昨天的数第一反应
 * 就是「这个月累计怎么样」，切来切去等于逼人记数字。
 * 代价是首屏很长，所以次级指标默认收起、次级周期用 dense 模式。
 */
export function PeriodBlock({
  period,
  kpis,
  extra,
  columns = 4,
  dense = false,
}: {
  period: Period;
  kpis: KpiValue[];
  /** 次级指标，默认收在「展开更多」里。不传就没有展开按钮 */
  extra?: KpiValue[];
  columns?: 3 | 4;
  dense?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  const gridClass =
    columns === 3
      ? 'grid grid-cols-2 gap-3 sm:grid-cols-3'
      : 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4';

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h4 className="text-sm font-semibold text-[var(--text-primary)]">{period.label}</h4>
          <span className="text-[11px] text-[var(--text-muted)]">
            {period.range.from === period.range.to
              ? period.range.from
              : `${period.range.from} 至 ${period.range.to}`}
          </span>
        </div>

        {/* 对比区间写出来，否则「环比前月」到底比的是上月整月还是上月同期，没人说得清 */}
        <span className="text-[11px] text-[var(--text-muted)]">
          {period.compareRange
            ? `${period.compareLabel}：${
                period.compareRange.from === period.compareRange.to
                  ? period.compareRange.from
                  : `${period.compareRange.from} 至 ${period.compareRange.to}`
              }`
            : `${period.compareLabel}：无可比数据`}
        </span>
      </div>

      <div className={gridClass}>
        {kpis.map((kpi) => (
          <StatTile key={kpi.key} kpi={kpi} compareLabel={period.compareLabel} dense={dense} />
        ))}
      </div>

      {extra && extra.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls={id}
            className="mt-2 rounded-md px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-wash)] hover:text-[var(--text-primary)]"
          >
            {open ? '收起其他指标' : `展开其他 ${extra.length} 项指标`}
          </button>

          {open && (
            <div id={id} className={`mt-2 ${gridClass}`}>
              {extra.map((kpi) => (
                <StatTile key={kpi.key} kpi={kpi} compareLabel={period.compareLabel} dense />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
