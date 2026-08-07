import { formatByKind, formatDeltaMagnitude } from '@/lib/format';
import type { KpiValue } from '@/lib/types';
import { Sparkline } from './Sparkline';

/**
 * KPI 卡片。
 *
 * 一堆头部数字就该是一排 stat tile，而不是一张分组柱状图 ——
 * 那些数字彼此不可比（客单价和转化率放同一根轴上毫无意义）。
 */
export function StatTile({ kpi, compareLabel = '环比' }: { kpi: KpiValue; compareLabel?: string }) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}
    >
      <div className="text-xs text-[var(--text-secondary)]">{kpi.label}</div>

      {/* 大号数字用比例字形；tabular 会让 121 这种数字显得松垮 */}
      <div className="mt-1.5 text-2xl font-semibold leading-none text-[var(--text-primary)]">
        {formatByKind(kpi.value, kpi.format)}
      </div>

      {/* 走势铺满一整行：卡片再窄也不会和数字抢位置 */}
      <div className="mt-2.5">
        <Sparkline values={kpi.trend} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <Delta label={compareLabel} rate={kpi.wow} higherIsBetter={kpi.higherIsBetter} />
        <Delta label="同比" rate={kpi.yoy} higherIsBetter={kpi.higherIsBetter} />
      </div>
    </div>
  );
}

/**
 * 变化率。方向色由「涨是不是好事」决定 —— 退款率涨 10% 是红的，不是绿的。
 * 箭头 + 文案和颜色同时在场，颜色从不单独承担含义。
 */
function Delta({
  label,
  rate,
  higherIsBetter,
}: {
  label: string;
  rate: number | null;
  higherIsBetter: boolean;
}) {
  if (rate === null) {
    return (
      <span className="text-[var(--text-muted)]">
        {label} <span className="tabular">—</span>
      </span>
    );
  }

  const isFlat = Math.abs(rate) < 0.0005;
  const isGood = higherIsBetter ? rate > 0 : rate < 0;
  const color = isFlat
    ? 'var(--text-muted)'
    : isGood
      ? 'var(--delta-up-good)'
      : 'var(--status-critical)';
  const arrow = isFlat ? '' : rate > 0 ? '↑' : '↓';

  return (
    <span className="text-[var(--text-muted)]">
      {label}{' '}
      {/* 箭头已经表达了方向，数值就不再带负号，否则「↓-18.1%」读起来像双重否定 */}
      <span className="tabular font-semibold" style={{ color }}>
        {arrow}
        {formatDeltaMagnitude(rate)}
      </span>
    </span>
  );
}
