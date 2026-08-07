'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import type { DateRange } from '@/lib/types';

/** 常用区间，省得为「近 7 天」去日历里点两下 */
const QUICK = [
  { label: '近 7 天', days: 7 },
  { label: '近 30 天', days: 30 },
  { label: '近 90 天', days: 90 },
];

/**
 * 自定义时间区间。
 *
 * 设了之后会额外多出一档「自定义」周期，并且投放 / 产品 / 流量的拆解口径
 * 都跟着切过去 —— 拆解和头部数字用不同区间是看板最容易出的错，
 * 两处数字对不上，读者就不知道该信哪个。
 */
export function CustomRange({ value, min, max }: { value: DateRange | null; min: string; max: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [from, setFrom] = useState(value?.from ?? '');
  const [to, setTo] = useState(value?.to ?? '');

  useEffect(() => {
    setFrom(value?.from ?? '');
    setTo(value?.to ?? '');
  }, [value?.from, value?.to]);

  // 重新取数时给内容区降透明度，保持上一帧不动：不闪骨架屏、不跳布局
  useEffect(() => {
    document.body.dataset.pending = isPending ? '1' : '0';
  }, [isPending]);

  function push(next: DateRange | null) {
    const search = new URLSearchParams(params.toString());
    if (next) {
      search.set('from', next.from);
      search.set('to', next.to);
    } else {
      search.delete('from');
      search.delete('to');
    }
    startTransition(() => {
      router.push(search.toString() ? `?${search.toString()}` : '?', { scroll: false });
    });
  }

  function applyQuick(days: number) {
    const end = new Date(`${max}T00:00:00Z`);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    const startStr = start.toISOString().slice(0, 10);
    push({ from: startStr < min ? min : startStr, to: max });
  }

  const dirty = from !== '' && to !== '' && (from !== value?.from || to !== value?.to);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-[var(--text-secondary)]">自定义区间</span>

      <div
        className="inline-flex items-center gap-1 rounded-lg border px-1.5 py-1"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}
      >
        <input
          type="date"
          value={from}
          min={min}
          max={max}
          aria-label="开始日期"
          onChange={(event) => setFrom(event.target.value)}
          className="bg-transparent text-xs text-[var(--text-primary)] outline-none"
        />
        <span aria-hidden className="text-xs text-[var(--text-muted)]">
          至
        </span>
        <input
          type="date"
          value={to}
          min={min}
          max={max}
          aria-label="结束日期"
          onChange={(event) => setTo(event.target.value)}
          className="bg-transparent text-xs text-[var(--text-primary)] outline-none"
        />
      </div>

      <button
        type="button"
        disabled={!dirty}
        onClick={() => push({ from, to })}
        className="rounded-md border px-2.5 py-1 text-xs transition-colors enabled:hover:bg-[var(--hover-wash)] disabled:opacity-40"
        style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
      >
        应用
      </button>

      {QUICK.map((item) => (
        <button
          key={item.days}
          type="button"
          onClick={() => applyQuick(item.days)}
          className="rounded-md px-2 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-wash)] hover:text-[var(--text-primary)]"
        >
          {item.label}
        </button>
      ))}

      {value && (
        <button
          type="button"
          onClick={() => push(null)}
          className="rounded-md px-2 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-wash)] hover:text-[var(--text-primary)]"
        >
          清除
        </button>
      )}
    </div>
  );
}
