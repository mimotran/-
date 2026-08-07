'use client';

import { useMemo, useState } from 'react';
import { EmptyChart, Legend, Tooltip, YGrid } from './parts';
import { barPath, linearScale, niceTicks, thinLabels } from './scale';
import { useChartWidth } from './useChartWidth';

export interface StackRow {
  label: string;
  fullLabel: string;
  values: number[];
}

/**
 * 堆叠柱状图：部分与整体，且要看每天的构成变化。
 *
 * 段与段之间留 2px 表面色缝隙来分隔，而不是给每段描边 ——
 * 描边是与数据无关的墨，缝隙不是。
 */
export function StackedColumnChart({
  rows,
  seriesNames,
  colors,
  formatValue,
  formatTooltip,
  height = 260,
  maxXLabels = 8,
}: {
  rows: StackRow[];
  seriesNames: string[];
  colors: string[];
  formatValue: (value: number) => string;
  formatTooltip?: (value: number) => string;
  height?: number;
  maxXLabels?: number;
}) {
  const [ref, width] = useChartWidth();
  const [active, setActive] = useState<number | null>(null);

  const margin = { top: 16, right: 12, bottom: 26, left: 56 };
  const plotLeft = margin.left;
  const plotRight = Math.max(plotLeft + 40, width - margin.right);
  const plotTop = margin.top;
  const plotBottom = height - margin.bottom;

  const count = rows.length;
  const GAP = 2;

  const { ticks, y, band, barWidth } = useMemo(() => {
    const totals = rows.map((row) => row.values.reduce((sum, value) => sum + value, 0));
    const tickValues = niceTicks(Math.max(0, ...totals));
    const scale = linearScale(tickValues[tickValues.length - 1], plotTop, plotBottom);
    const bandWidth = count > 0 ? (plotRight - plotLeft) / count : 0;
    // 上限 24px：柱子永远不填满整条带，留出的空隙就是呼吸感
    return {
      ticks: tickValues,
      y: scale,
      band: bandWidth,
      barWidth: Math.max(2, Math.min(24, bandWidth - GAP)),
    };
  }, [rows, count, plotLeft, plotRight, plotTop, plotBottom]);

  const visibleLabels = useMemo(() => thinLabels(count, maxXLabels), [count, maxXLabels]);

  if (count === 0 || seriesNames.length === 0) {
    return <EmptyChart hint="当前区间没有渠道数据" />;
  }

  const tooltipFormat = formatTooltip ?? formatValue;
  const legend = seriesNames.map((name, index) => ({
    key: name,
    name,
    color: colors[index % colors.length],
  }));

  function handleMove(event: React.PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const index = Math.floor((event.clientX - rect.left - plotLeft) / band);
    setActive(Math.max(0, Math.min(count - 1, index)));
  }

  return (
    <div ref={ref} className="relative w-full">
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`堆叠柱状图，${seriesNames.join('、')}`}
        onPointerMove={handleMove}
        onPointerLeave={() => setActive(null)}
        className="touch-none"
      >
        <YGrid ticks={ticks} scale={y} left={plotLeft} right={plotRight} format={formatValue} />

        {rows.map((row, rowIndex) => {
          const x = plotLeft + band * rowIndex + (band - barWidth) / 2;
          let cursor = plotBottom;
          const isActive = active === rowIndex;
          // 最顶上那段带圆角，其余段方头并让出缝隙
          const topIndex = lastPositiveIndex(row.values);

          return (
            <g key={row.fullLabel} opacity={active === null || isActive ? 1 : 0.55}>
              {row.values.map((value, seriesIndex) => {
                if (value <= 0) return null;
                const rawHeight = plotBottom - y(value);
                // 除最顶段外都让出 2px 做缝隙；段太薄时不再切，免得直接消失
                const isTop = topIndex === seriesIndex;
                const segmentHeight = Math.max(1, isTop ? rawHeight : rawHeight - GAP);
                const top = cursor - rawHeight;
                cursor = top;

                return (
                  <path
                    key={seriesIndex}
                    d={
                      isTop
                        ? barPath(x, top, barWidth, segmentHeight, 4)
                        : `M${x},${top + GAP}h${barWidth}v${segmentHeight}h${-barWidth}Z`
                    }
                    fill={colors[seriesIndex % colors.length]}
                  />
                );
              })}
            </g>
          );
        })}

        <line
          x1={plotLeft}
          x2={plotRight}
          y1={plotBottom}
          y2={plotBottom}
          stroke="var(--axis)"
          strokeWidth={1}
        />
        {rows.map((row, index) =>
          visibleLabels.has(index) ? (
            <text
              key={row.fullLabel}
              x={plotLeft + band * index + band / 2}
              y={plotBottom + 15}
              textAnchor="middle"
              fontSize={11}
              fill="var(--text-muted)"
              className="tabular"
            >
              {row.label}
            </text>
          ) : null,
        )}
      </svg>

      {active !== null && (
        <Tooltip
          x={plotLeft + band * active + band / 2}
          containerWidth={width}
          title={rows[active].fullLabel}
          rows={rows[active].values
            .map((value, index) => ({
              key: seriesNames[index],
              name: seriesNames[index],
              color: colors[index % colors.length],
              value: tooltipFormat(value),
              raw: value,
            }))
            .filter((row) => row.raw > 0)}
          footer={`合计 ${tooltipFormat(rows[active].values.reduce((sum, value) => sum + value, 0))}`}
        />
      )}

      <Legend series={legend} mark="rect" />
    </div>
  );
}

/** 最上面那段有值的序号；整根柱子都是 0 时返回 -1 */
function lastPositiveIndex(values: number[]): number {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] > 0) return i;
  }
  return -1;
}
