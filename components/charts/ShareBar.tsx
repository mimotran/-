'use client';

import { useState } from 'react';
import { Legend } from './parts';

export interface ShareSegment {
  key: string;
  name: string;
  value: number;
  color: string;
}

/**
 * 单条横向堆叠条：部分与整体。
 *
 * 比饼图好在能直接比较相邻段的长度，中文类目名也放得下。
 * 段之间用 2px 表面色缝隙分隔，不描边。
 * 段太窄时不硬塞内嵌标签 —— 宁可交给图例和数据表，也不能让文字被裁掉。
 */
export function ShareBar({
  segments,
  formatValue,
  height = 28,
}: {
  segments: ShareSegment[];
  formatValue: (value: number) => string;
  height?: number;
}) {
  const [active, setActive] = useState<string | null>(null);
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);

  if (total <= 0) {
    return (
      <div className="flex h-16 items-center justify-center rounded-lg border border-dashed border-[var(--border)] text-sm text-[var(--text-muted)]">
        当前区间没有商品数据
      </div>
    );
  }

  return (
    <div>
      <div className="flex w-full gap-0.5" style={{ height }} role="img" aria-label="类目结构占比">
        {segments.map((segment) => {
          const share = segment.value / total;
          // 12% 以上才放得下「配件 23%」这样的内嵌标签，否则留白
          const showLabel = share >= 0.12;
          return (
            <div
              key={segment.key}
              className="relative flex min-w-[3px] items-center justify-center rounded-[4px] transition-opacity"
              style={{
                flexBasis: `${share * 100}%`,
                background: segment.color,
                opacity: active === null || active === segment.key ? 1 : 0.55,
              }}
              onPointerEnter={() => setActive(segment.key)}
              onPointerLeave={() => setActive(null)}
              title={`${segment.name} ${formatValue(segment.value)}`}
            >
              {showLabel && (
                <span className="tabular px-1 text-[11px] font-semibold text-white">
                  {(share * 100).toFixed(0)}%
                </span>
              )}
            </div>
          );
        })}
      </div>

      <Legend series={segments} mark="rect" />
    </div>
  );
}
