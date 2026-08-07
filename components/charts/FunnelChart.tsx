'use client';

import type { FunnelStage } from '@/lib/metrics';
import { formatInteger, formatPercent } from '@/lib/format';

const ORDINAL = ['var(--ordinal-1)', 'var(--ordinal-2)', 'var(--ordinal-3)', 'var(--ordinal-4)'];

/**
 * 转化漏斗。
 *
 * 各层之间有天然顺序，所以用**单色阶**而不是分类色 —— 分类色会暗示
 * 「访客」和「支付买家」是两类互不相干的东西，而它们其实是同一批人的两个阶段。
 *
 * 用 HTML 条而非 SVG：层数少、要放中文标签，纯 DOM 更好排版也更好读屏。
 */
export function FunnelChart({ stages }: { stages: FunnelStage[] }) {
  const head = stages[0]?.value ?? 0;
  if (head <= 0) {
    return (
      <div className="flex h-[200px] items-center justify-center rounded-lg border border-dashed border-[var(--border)] text-sm text-[var(--text-muted)]">
        当前区间没有流量数据
      </div>
    );
  }

  return (
    <ol className="space-y-3">
      {stages.map((stage, index) => (
        <li key={stage.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="text-xs text-[var(--text-secondary)]">{stage.label}</span>
            <span className="flex items-baseline gap-2">
              <span className="tabular text-sm font-semibold text-[var(--text-primary)]">
                {formatInteger(stage.value)}
              </span>
              {index > 0 && (
                <span className="tabular text-[11px] text-[var(--text-muted)]">
                  较上层 {formatPercent(stage.stepRate, 1)}
                </span>
              )}
            </span>
          </div>
          <div
            className="h-4 w-full overflow-hidden rounded-[4px]"
            style={{ background: 'var(--hover-wash)' }}
          >
            <div
              className="h-full rounded-[4px]"
              style={{
                width: `${Math.max(1.5, stage.overallRate * 100)}%`,
                background: ORDINAL[index % ORDINAL.length],
              }}
              role="img"
              aria-label={`${stage.label} 占访客 ${formatPercent(stage.overallRate, 1)}`}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}
