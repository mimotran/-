import { formatByKind, formatDeltaMagnitude, formatPercent } from '@/lib/format';
import type { GoalRow } from '@/lib/types';

/**
 * 一个大区块里的指标卡片。
 *
 * 每张卡给四个数：目标、实际、达成情况、对比上期。
 *
 * 达成情况分两种写法，取决于指标类型：
 *   比值型（GMV、投放费、ROI）→ 达成率 = 实际 ÷ 目标
 *   率型（退款率、费比、利润率）→ 百分点差 = 实际 − 目标
 * 退款率目标 26%、实际 29.35% 写成「达成率 112.9%」没有意义，
 * 运营要知道的是「超了 3.4 个点」。
 */
export function GoalGroupBlock({
  rows,
  compareLabel,
}: {
  rows: GoalRow[];
  compareLabel: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {rows.map((row) => (
        <GoalCard key={row.key} row={row} compareLabel={compareLabel} />
      ))}
    </div>
  );
}

function GoalCard({ row, compareLabel }: { row: GoalRow; compareLabel: string }) {
  const color =
    row.good === null
      ? 'var(--text-muted)'
      : row.good
        ? 'var(--delta-up-good)'
        : 'var(--status-critical)';

  // 达成条只对比值型有意义：率型没有「完成了百分之多少」这回事
  const bar = row.attainment !== null ? Math.min(100, Math.max(0, row.attainment * 100)) : null;

  return (
    <div
      className="rounded-xl border p-3.5"
      style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-[var(--text-secondary)]">{row.label}</span>
        <span className="tabular text-xs font-semibold" style={{ color }}>
          {row.attainment !== null
            ? formatPercent(row.attainment, 1)
            : row.ppDiff !== null
              ? `${row.ppDiff > 0 ? '+' : ''}${(row.ppDiff * 100).toFixed(2)}pp`
              : '无目标'}
        </span>
      </div>

      <div className="mt-1.5 text-lg font-semibold leading-none text-[var(--text-primary)]">
        {formatByKind(row.actual, row.format)}
      </div>

      <div className="mt-1.5 text-[11px] text-[var(--text-muted)]">
        目标{' '}
        <span className="tabular">
          {row.target !== null ? formatByKind(row.target, row.format) : '—'}
        </span>
      </div>

      {bar !== null && (
        <div
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full"
          style={{ background: 'var(--hover-wash)' }}
          role="img"
          aria-label={`达成 ${formatPercent(row.attainment ?? 0, 1)}`}
        >
          <div
            className="h-full rounded-full"
            style={{ width: `${bar}%`, background: color }}
          />
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-2 text-[11px] text-[var(--text-muted)]">
        <span>
          {compareLabel}{' '}
          <span className="tabular">
            {row.prevActual !== null ? formatByKind(row.prevActual, row.format) : '—'}
          </span>
        </span>
        {row.prevDelta !== null && (
          <span
            className="tabular font-semibold"
            style={{
              color:
                Math.abs(row.prevDelta) < 0.0005
                  ? 'var(--text-muted)'
                  : (row.higherIsBetter ? row.prevDelta > 0 : row.prevDelta < 0)
                    ? 'var(--delta-up-good)'
                    : 'var(--status-critical)',
            }}
          >
            {row.prevDelta > 0 ? '↑' : '↓'}
            {formatDeltaMagnitude(row.prevDelta)}
          </span>
        )}
      </div>
    </div>
  );
}
