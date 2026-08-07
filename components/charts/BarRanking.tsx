'use client';

import { useMemo, useState } from 'react';
import { truncateToWidth } from '@/lib/format';
import { EmptyChart, Tooltip } from './parts';
import { hBarPath } from './scale';
import { useChartWidth } from './useChartWidth';

export interface RankingRow {
  key: string;
  label: string;
  value: number;
  /** tooltip 里的补充信息，如「转化率 2.31%」 */
  detail?: string;
}

/**
 * 排行条形图。
 *
 * 名义类目（渠道、商品）**统一用一个颜色** —— 按大小上色阶等于把长度这个
 * 已经在图上的信息又用色相编码一遍，白白烧掉唯一的自由通道。
 * 名称长、条目多，所以走横向。
 */
export function BarRanking({
  rows,
  formatValue,
  labelWidth = 128,
  barHeight = 18,
  gap = 10,
}: {
  rows: RankingRow[];
  formatValue: (value: number) => string;
  labelWidth?: number;
  barHeight?: number;
  gap?: number;
}) {
  const [ref, width] = useChartWidth();
  const [active, setActive] = useState<number | null>(null);

  // 右侧留出直标数值的位置
  const valueWidth = 72;
  const plotLeft = labelWidth + 12;
  const plotRight = Math.max(plotLeft + 40, width - valueWidth);
  const height = rows.length * (barHeight + gap) + gap;

  const max = useMemo(() => Math.max(1, ...rows.map((row) => row.value)), [rows]);

  if (rows.length === 0) return <EmptyChart hint="当前区间没有可排行的数据" />;

  return (
    <div ref={ref} className="relative w-full">
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="排行条形图"
        onPointerLeave={() => setActive(null)}
      >
        {rows.map((row, index) => {
          const y = gap + index * (barHeight + gap);
          const barWidth = ((plotRight - plotLeft) * row.value) / max;
          const isActive = active === index;

          return (
            <g
              key={row.key}
              onPointerEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
              tabIndex={0}
              role="listitem"
              aria-label={`${row.label} ${formatValue(row.value)}`}
              className="outline-none"
            >
              {/* 命中区盖满整行，别让用户去瞄那根 18px 的条 */}
              <rect x={0} y={y - gap / 2} width={width} height={barHeight + gap} fill="transparent" />
              <text
                x={labelWidth}
                y={y + barHeight / 2}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={12}
                fill={isActive ? 'var(--text-primary)' : 'var(--text-secondary)'}
              >
                {truncateToWidth(row.label, labelWidth - 6)}
              </text>
              {/* 名称被截断时，完整名走原生 title，鼠标停住就能看全 */}
              <title>{row.label}</title>
              <path
                d={hBarPath(plotLeft, y, Math.max(2, barWidth), barHeight, 4)}
                fill="var(--series-1)"
                opacity={active === null || isActive ? 1 : 0.6}
              />
              <text
                x={plotLeft + barWidth + 8}
                y={y + barHeight / 2}
                dominantBaseline="middle"
                fontSize={11}
                fontWeight={600}
                fill="var(--text-primary)"
                className="tabular"
              >
                {formatValue(row.value)}
              </text>
            </g>
          );
        })}
      </svg>

      {active !== null && rows[active].detail && (
        <Tooltip
          x={Math.min(plotLeft + 40, width - 200)}
          containerWidth={width}
          title={rows[active].label}
          rows={[
            {
              key: rows[active].key,
              name: '本期',
              color: 'var(--series-1)',
              value: formatValue(rows[active].value),
            },
          ]}
          footer={rows[active].detail}
        />
      )}
    </div>
  );
}
