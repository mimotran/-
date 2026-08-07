'use client';

import { useState } from 'react';
import { Card, SectionHeading } from '@/components/ui/Card';
import { GoalGroupBlock } from '@/components/ui/GoalGroupBlock';
import { formatPercent } from '@/lib/format';
import type { GoalPeriod } from '@/lib/types';

/**
 * 目标达成。
 *
 * 放在最上面 —— 打开看板第一个问题永远是「这个月还差多少」，
 * 而不是「昨天卖了多少」。
 *
 * 结构照飞书目标表：一个大区块（销售 / 费用 / 利润 / 流量）一行，
 * 行内按指标分块。口径（本月 / 本季 / 半年 / 全年 / 自定义）在右上角切换。
 */
export function GoalAttainment({ goals }: { goals: GoalPeriod[] }) {
  const [index, setIndex] = useState(0);
  const period = goals[index];

  if (!period) return null;

  return (
    <section aria-labelledby="goal-attainment">
      <SectionHeading
        id="goal-attainment"
        title="目标达成"
        description="达成率 = 实际 ÷ 目标；退款率、费比、利润率这类率型指标看的是百分点差（实际 − 目标），写成达成率没有意义。计划进度按月度目标分布加权，不是日历天数。"
      />

      <div
        className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}
      >
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
          <span className="text-[var(--text-secondary)]">
            口径 <strong className="text-[var(--text-primary)]">{period.scope}</strong>
          </span>
          <span className="text-[var(--text-muted)]">
            {period.range.from} 至 {period.range.to}
          </span>
          <span className="text-[var(--text-muted)]">
            计划进度 <span className="tabular">{formatPercent(period.timeProgress, 0)}</span>
          </span>
          <span className="text-[var(--text-muted)]">对比 {period.compareLabel}</span>
        </div>

        <div role="group" aria-label="达成口径" className="flex flex-wrap gap-1">
          {goals.map((goal, i) => (
            <button
              key={goal.key}
              type="button"
              aria-pressed={i === index}
              onClick={() => setIndex(i)}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                i === index
                  ? 'font-semibold text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--hover-wash)]'
              }`}
              style={{
                borderColor: 'var(--border)',
                background: i === index ? 'var(--hover-wash)' : 'transparent',
              }}
            >
              {goal.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {period.groups.map((group) => (
          <Card key={group.name} title={group.name}>
            <GoalGroupBlock rows={group.rows} compareLabel={period.compareLabel} />
          </Card>
        ))}
      </div>
    </section>
  );
}
