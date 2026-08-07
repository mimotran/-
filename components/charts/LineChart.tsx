'use client';

import { useMemo, useState } from 'react';
import { EmptyChart, Legend, Tooltip, YGrid, type SeriesDef } from './parts';
import { bandCenters, linePath, linearScale, niceTicks, thinLabels } from './scale';
import { useChartWidth } from './useChartWidth';

export interface LineSeries extends SeriesDef {
  values: Array<number | null>;
  /** 参照系列（去年同期、基线）用弱化色，且不参与端点标注 */
  muted?: boolean;
}

/**
 * 折线图：时间趋势的默认形态。
 *
 * 交互按规范来 —— 竖直准星找 X，一个 tooltip 列出该 X 上所有系列的值，
 * 读者瞄的是日期，不是那条 2px 的线。
 */
export function LineChart({
  labels,
  fullLabels,
  series,
  formatValue,
  formatTooltip,
  height = 240,
  maxXLabels = 8,
}: {
  /** 横轴短标签，如 8/7 */
  labels: string[];
  /** tooltip 里的完整标签，如 2026 年 8 月 7 日 */
  fullLabels: string[];
  series: LineSeries[];
  formatValue: (value: number) => string;
  formatTooltip?: (value: number) => string;
  height?: number;
  maxXLabels?: number;
}) {
  const [ref, width] = useChartWidth();
  const [active, setActive] = useState<number | null>(null);

  const margin = { top: 16, right: 56, bottom: 26, left: 56 };
  const plotLeft = margin.left;
  const plotRight = Math.max(plotLeft + 40, width - margin.right);
  const plotTop = margin.top;
  const plotBottom = height - margin.bottom;

  const count = labels.length;

  const { ticks, y, xs } = useMemo(() => {
    const max = Math.max(
      0,
      ...series.flatMap((item) => item.values.map((value) => value ?? 0)),
    );
    const tickValues = niceTicks(max);
    const scale = linearScale(tickValues[tickValues.length - 1], plotTop, plotBottom);
    return { ticks: tickValues, y: scale, xs: bandCenters(count, plotLeft, plotRight) };
  }, [series, count, plotLeft, plotRight, plotTop, plotBottom]);

  const visibleLabels = useMemo(() => thinLabels(count, maxXLabels), [count, maxXLabels]);

  if (count === 0 || series.length === 0) {
    return <EmptyChart hint="当前区间没有数据" />;
  }

  const tooltipFormat = formatTooltip ?? formatValue;
  // 端点直标只给主系列，避免线收敛时几个标签叠在一起
  const primary = series.find((item) => !item.muted) ?? series[0];
  const primaryLastIndex = lastDefined(primary.values);

  function handleMove(event: React.PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const step = (plotRight - plotLeft) / count;
    const index = Math.round((x - plotLeft - step / 2) / step);
    setActive(Math.max(0, Math.min(count - 1, index)));
  }

  return (
    <div ref={ref} className="relative w-full">
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`折线图，${series.map((item) => item.name).join('、')}`}
        onPointerMove={handleMove}
        onPointerLeave={() => setActive(null)}
        className="touch-none"
      >
        <YGrid ticks={ticks} scale={y} left={plotLeft} right={plotRight} format={formatValue} />

        {/* 准星：先画，压在数据线下面 */}
        {active !== null && (
          <line
            x1={xs[active]}
            x2={xs[active]}
            y1={plotTop}
            y2={plotBottom}
            stroke="var(--axis)"
            strokeWidth={1}
          />
        )}

        {series.map((item) => (
          <path
            key={item.key}
            d={linePath(xs, item.values.map((value) => (value === null ? null : y(value))))}
            fill="none"
            stroke={item.muted ? 'var(--series-muted)' : item.color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* 悬停点：2px 表面色描边，压在线上也看得清 */}
        {active !== null &&
          series.map((item) => {
            const value = item.values[active];
            if (value === null || value === undefined) return null;
            return (
              <circle
                key={item.key}
                cx={xs[active]}
                cy={y(value)}
                r={4}
                fill={item.muted ? 'var(--series-muted)' : item.color}
                stroke="var(--surface-1)"
                strokeWidth={2}
              />
            );
          })}

        {/* 端点直标：只标主系列最后一个有值的点 */}
        {primaryLastIndex >= 0 && (
          <>
            <circle
              cx={xs[primaryLastIndex]}
              cy={y(primary.values[primaryLastIndex]!)}
              r={4}
              fill={primary.color}
              stroke="var(--surface-1)"
              strokeWidth={2}
            />
            <text
              x={Math.min(xs[primaryLastIndex] + 10, width - 4)}
              y={y(primary.values[primaryLastIndex]!)}
              dominantBaseline="middle"
              fontSize={11}
              fontWeight={600}
              fill="var(--text-primary)"
              className="tabular"
            >
              {formatValue(primary.values[primaryLastIndex]!)}
            </text>
          </>
        )}

        {/* 横轴 */}
        <line
          x1={plotLeft}
          x2={plotRight}
          y1={plotBottom}
          y2={plotBottom}
          stroke="var(--axis)"
          strokeWidth={1}
        />
        {labels.map((label, index) =>
          visibleLabels.has(index) ? (
            <text
              key={`${label}-${index}`}
              x={xs[index]}
              y={plotBottom + 15}
              textAnchor="middle"
              fontSize={11}
              fill="var(--text-muted)"
              className="tabular"
            >
              {label}
            </text>
          ) : null,
        )}
      </svg>

      {active !== null && (
        <Tooltip
          x={xs[active]}
          containerWidth={width}
          title={fullLabels[active] ?? labels[active]}
          rows={series
            .filter((item) => item.values[active] !== null && item.values[active] !== undefined)
            .map((item) => ({
              key: item.key,
              name: item.name,
              color: item.muted ? 'var(--series-muted)' : item.color,
              value: tooltipFormat(item.values[active]!),
            }))}
        />
      )}

      <Legend series={series.map((item) => ({ ...item, color: item.muted ? 'var(--series-muted)' : item.color }))} />
    </div>
  );
}

function lastDefined(values: Array<number | null>): number {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] !== null && values[i] !== undefined) return i;
  }
  return -1;
}
