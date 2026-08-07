import { formatCurrency, formatInteger, formatPercent } from '@/lib/format';

/**
 * 目标达成条。
 *
 * 关键设计：进度条上有一根「计划进度」刻度线。只看达成率没法判断好坏 ——
 * 8 月 7 号完成 25% 是超前，12 月 20 号完成 90% 是落后。
 *
 * 这根线是**按月度目标分布加权**的，不是按日历天数。下半年的目标有很大一块
 * 压在双 11 上，按天数算会把一个正常的 8 月判成「落后」。
 */
export function GoalBar({
  label,
  scope,
  actual,
  target,
  timeProgress,
  finished,
  kind,
}: {
  label: string;
  scope: string;
  actual: number;
  target: number;
  timeProgress: number;
  finished: boolean;
  kind: 'currency' | 'integer';
}) {
  const progress = target > 0 ? actual / target : 0;
  // 销量走 formatInteger（十万以下不压缩）——「9,244 / 12,300」比「9,244 / 1.2万」好比较
  const format = (value: number) => (kind === 'currency' ? formatCurrency(value) : formatInteger(value));

  // 领先 / 落后：达成进度减计划进度。周期结束后就只看达成与否
  const lead = progress - timeProgress;
  // 差距 2 个点以内算「基本持平」——写「落后 0.6%」却标成绿色是自相矛盾的，
  // 要么承认它没问题（持平，中性色），要么承认它落后（红色）
  const flat = !finished && Math.abs(lead) < 0.02;
  const onTrack = finished ? progress >= 1 : lead >= 0;
  const statusColor = flat
    ? 'var(--text-muted)'
    : onTrack
      ? 'var(--delta-up-good)'
      : 'var(--status-critical)';
  const gap = target - actual;

  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-[var(--text-primary)]">{label}</span>
          <span className="text-[11px] text-[var(--text-muted)]">{scope}</span>
        </div>
        <span
          className="tabular text-sm font-semibold"
          style={{ color: statusColor }}
        >
          {formatPercent(progress, 1)}
        </span>
      </div>

      <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
        <span className="tabular">{format(actual)}</span>
        <span className="text-[var(--text-muted)]"> / {format(target)}</span>
      </div>

      {/* 进度槽 */}
      <div
        className="relative mt-2.5 h-2.5 w-full overflow-hidden rounded-full"
        role="img"
        aria-label={`${label}达成 ${formatPercent(progress, 1)}，计划进度 ${formatPercent(timeProgress, 1)}`}
        style={{ background: 'var(--hover-wash)' }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.min(100, progress * 100)}%`,
            background: flat || onTrack ? 'var(--series-1)' : 'var(--status-serious)',
          }}
        />
        {/* 计划进度刻度：周期结束后没有参考意义，不画 */}
        {!finished && timeProgress > 0 && timeProgress < 1 && (
          <div
            className="absolute top-0 h-full"
            style={{
              left: `${timeProgress * 100}%`,
              width: 2,
              background: 'var(--text-primary)',
              opacity: 0.55,
            }}
          />
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
        <span>计划进度 {formatPercent(timeProgress, 0)}</span>
        {/* 状态永远配文案，颜色从不单独承担含义 */}
        <span style={{ color: statusColor }}>
          {finished
            ? progress >= 1
              ? '已达成'
              : `未达成，差 ${format(Math.max(0, gap))}`
            : flat
              ? '基本持平'
              : lead > 0
                ? `超前 ${formatPercent(lead, 1)}`
                : `落后 ${formatPercent(-lead, 1)}`}
        </span>
      </div>

      {!finished && gap > 0 && (
        <div className="mt-1 text-[11px] text-[var(--text-muted)]">还差 {format(gap)}</div>
      )}
    </div>
  );
}
