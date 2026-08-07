import { formatCurrency, formatDeltaMagnitude, formatExact } from '@/lib/format';
import type { KpiValue } from '@/lib/types';

/**
 * 看板的头号数字。整页只有一个。
 *
 * 字号 ≥48px，字体仍是系统 sans —— 换成衬线或展示体会立刻显得像装饰而不是数据。
 * 用比例字形，等宽字形会让大号数字之间显得松散。
 */
export function HeroFigure({ kpi, rangeLabel }: { kpi: KpiValue; rangeLabel: string }) {
  return (
    <div>
      <div className="text-xs text-[var(--text-secondary)]">
        {kpi.label} · {rangeLabel}
      </div>
      <div className="mt-1 text-[48px] font-semibold leading-[1.05] tracking-tight text-[var(--text-primary)]">
        {formatCurrency(kpi.value)}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="text-[var(--text-muted)]">
          精确值 <span className="tabular">{formatExact(kpi.value, 'currency')}</span>
        </span>
        <Compare label="环比" rate={kpi.wow} />
        <Compare label="同比" rate={kpi.yoy} />
      </div>
    </div>
  );
}

function Compare({ label, rate }: { label: string; rate: number | null }) {
  if (rate === null) {
    return (
      <span className="text-[var(--text-muted)]">
        {label} <span className="tabular">—</span>
      </span>
    );
  }
  const isFlat = Math.abs(rate) < 0.0005;
  const color = isFlat
    ? 'var(--text-muted)'
    : rate > 0
      ? 'var(--delta-up-good)'
      : 'var(--status-critical)';

  return (
    <span className="text-[var(--text-muted)]">
      {label}{' '}
      <span className="tabular font-semibold" style={{ color }}>
        {isFlat ? '' : rate > 0 ? '↑' : '↓'}
        {formatDeltaMagnitude(rate)}
      </span>
    </span>
  );
}
