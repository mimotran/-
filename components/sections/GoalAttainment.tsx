'use client';

import { Card, SectionHeading } from '@/components/ui/Card';
import { GoalBar } from '@/components/ui/GoalBar';
import { TableView } from '@/components/ui/TableView';
import { formatCompact, formatCurrency, formatPercent } from '@/lib/format';
import type { GoalProgress } from '@/lib/types';

/**
 * 目标达成。
 *
 * 放在最上面 —— 打开看板第一个问题永远是「这个月还差多少」，
 * 而不是「昨天卖了多少」。
 */
export function GoalAttainment({ goals }: { goals: GoalProgress[] }) {
  return (
    <section aria-labelledby="goal-attainment">
      <SectionHeading
        id="goal-attainment"
        title="目标达成"
        description="月度目标来自飞书目标表，季度与半年由月度目标按天累加得出。进度条上的竖线是「计划进度」—— 按月度目标的分布加权，不是按日历天数，否则双 11 的量会把 8 月误判成落后。"
      />

      <div className="space-y-4">
        <Card title="GMV 达成" hint="实际支付金额对目标">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {goals.map((goal) => (
              <GoalBar
                key={`gmv-${goal.key}`}
                label={goal.label}
                scope={goal.scope}
                actual={goal.gmvActual}
                target={goal.gmvTarget}
                timeProgress={goal.timeProgress}
                finished={goal.finished}
                kind="currency"
              />
            ))}
          </div>
        </Card>

        <Card title="主机销量达成" hint="只统计录音笔本体，不含会员和配件">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {goals.map((goal) => (
              <GoalBar
                key={`device-${goal.key}`}
                label={goal.label}
                scope={goal.scope}
                actual={goal.deviceActual}
                target={goal.deviceTarget}
                timeProgress={goal.timeProgress}
                finished={goal.finished}
                kind="integer"
              />
            ))}
          </div>

          <TableView
            caption="各周期目标达成明细"
            rows={goals}
            columns={[
              { key: 'label', header: '周期', render: (row) => `${row.label}（${row.scope}）` },
              { key: 'gmvActual', header: 'GMV 实际', numeric: true, render: (row) => formatCurrency(row.gmvActual) },
              { key: 'gmvTarget', header: 'GMV 目标', numeric: true, render: (row) => formatCurrency(row.gmvTarget) },
              {
                key: 'gmvRate',
                header: 'GMV 达成率',
                numeric: true,
                render: (row) => (row.gmvTarget > 0 ? formatPercent(row.gmvActual / row.gmvTarget, 1) : '—'),
              },
              { key: 'deviceActual', header: '销量实际', numeric: true, render: (row) => formatCompact(row.deviceActual) },
              { key: 'deviceTarget', header: '销量目标', numeric: true, render: (row) => formatCompact(row.deviceTarget) },
              {
                key: 'deviceRate',
                header: '销量达成率',
                numeric: true,
                render: (row) => (row.deviceTarget > 0 ? formatPercent(row.deviceActual / row.deviceTarget, 1) : '—'),
              },
              { key: 'time', header: '时间进度', numeric: true, render: (row) => formatPercent(row.timeProgress, 0) },
            ]}
          />
        </Card>
      </div>
    </section>
  );
}
