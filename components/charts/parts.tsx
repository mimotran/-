'use client';

import type { ReactNode } from 'react';

export interface SeriesDef {
  key: string;
  name: string;
  /** CSS 变量引用，如 var(--series-1) */
  color: string;
}

/**
 * 图例：两个及以上系列必须有，颜色之外再给一条可靠的身份线索。
 * 标记形状跟随图表本身 —— 折线用线段，柱/面积用色块。
 */
export function Legend({
  series,
  mark = 'line',
}: {
  series: SeriesDef[];
  mark?: 'line' | 'rect';
}) {
  if (series.length < 2) return null;
  return (
    <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {series.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
          {mark === 'line' ? (
            <span
              aria-hidden
              className="inline-block h-0.5 w-4 rounded-full"
              style={{ background: item.color }}
            />
          ) : (
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-[2px]"
              style={{ background: item.color }}
            />
          )}
          {item.name}
        </li>
      ))}
    </ul>
  );
}

export interface TooltipRow {
  key: string;
  name: string;
  color: string;
  value: string;
}

/**
 * 悬浮读数。数值是主角（高对比、加粗），系列名退到次要位置 ——
 * 读者已经知道自己在看哪条线，想要的是那个数字。
 */
export function Tooltip({
  x,
  containerWidth,
  title,
  rows,
  footer,
}: {
  x: number;
  containerWidth: number;
  title: string;
  rows: TooltipRow[];
  footer?: ReactNode;
}) {
  const width = 190;
  // 贴边时翻到另一侧，别被容器裁掉
  const left = Math.min(Math.max(x + 14, 8), Math.max(8, containerWidth - width - 8));

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute top-2 z-10 rounded-lg border px-3 py-2 shadow-lg"
      style={{
        left,
        width,
        background: 'var(--surface-1)',
        borderColor: 'var(--border)',
      }}
    >
      <div className="mb-1.5 text-[11px] text-[var(--text-muted)]">{title}</div>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.key} className="flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-0.5 w-3 shrink-0 rounded-full"
                style={{ background: row.color }}
              />
              <span className="truncate text-[11px] text-[var(--text-secondary)]">{row.name}</span>
            </span>
            <span className="tabular shrink-0 text-xs font-semibold text-[var(--text-primary)]">
              {row.value}
            </span>
          </li>
        ))}
      </ul>
      {footer ? <div className="mt-1.5 text-[11px] text-[var(--text-muted)]">{footer}</div> : null}
    </div>
  );
}

/** 水平网格线 + 纵轴刻度，统一的实线发丝线，绝不用虚线 */
export function YGrid({
  ticks,
  scale,
  left,
  right,
  format,
}: {
  ticks: number[];
  scale: (value: number) => number;
  left: number;
  right: number;
  format: (value: number) => string;
}) {
  return (
    <g aria-hidden>
      {ticks.map((tick) => {
        const y = scale(tick);
        return (
          <g key={tick}>
            <line
              x1={left}
              x2={right}
              y1={y}
              y2={y}
              stroke={tick === 0 ? 'var(--axis)' : 'var(--grid)'}
              strokeWidth={1}
            />
            <text
              x={left - 8}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              className="tabular"
              fontSize={11}
              fill="var(--text-muted)"
            >
              {format(tick)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** 空态：没有数据时给一句人话，而不是一张空白坐标系 */
export function EmptyChart({ hint }: { hint: string }) {
  return (
    <div className="flex h-[200px] items-center justify-center rounded-lg border border-dashed border-[var(--border)] px-4 text-center text-sm text-[var(--text-muted)]">
      {hint}
    </div>
  );
}
