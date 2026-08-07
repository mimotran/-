'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useTransition } from 'react';
import { RANGE_LABELS } from '@/lib/metrics';
import type { RangePreset } from '@/lib/types';

const PRESETS: RangePreset[] = ['7d', '30d', '90d', 'mtd'];

/**
 * 日期区间筛选。
 *
 * 一行，放在所有内容之上，作用域覆盖整个页面 —— 不做每张图各自的筛选器，
 * 否则卡片之间的数字对不上，读者没法判断哪个才算数。
 *
 * 预设按行列出，「近 30 天」这种需求没人愿意去日历格子里点两下。
 */
export function RangeFilter({ value }: { value: RangePreset }) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // 重新取数时给内容区降透明度，保持上一帧不动：不闪骨架屏、不跳布局
  useEffect(() => {
    document.body.dataset.pending = isPending ? '1' : '0';
  }, [isPending]);

  function select(preset: RangePreset) {
    const next = new URLSearchParams(params.toString());
    next.set('range', preset);
    startTransition(() => {
      router.push(`?${next.toString()}`, { scroll: false });
    });
  }

  return (
    <div
      role="group"
      aria-label="日期区间"
      className="inline-flex items-center gap-0.5 rounded-lg border p-0.5"
      style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}
    >
      {PRESETS.map((preset) => {
        const selected = preset === value;
        return (
          <button
            key={preset}
            type="button"
            aria-pressed={selected}
            onClick={() => select(preset)}
            className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
              selected
                ? 'font-semibold text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--hover-wash)]'
            }`}
            style={selected ? { background: 'var(--hover-wash)' } : undefined}
          >
            {RANGE_LABELS[preset]}
          </button>
        );
      })}
    </div>
  );
}
