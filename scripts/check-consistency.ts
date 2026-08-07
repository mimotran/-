/**
 * 数据一致性自检：`npm run check`
 *
 * 检查分项之和是否等于大盘 —— 渠道 GMV 加起来必须等于当日支付金额，
 * 商品明细也一样。运营核对时第一个发现的就是这类对不上，
 * 一旦对不上，之后整个看板的数字都不会有人再信。
 *
 * 默认检查当前数据源（有快照读快照，否则用 mock）。
 */

import { getSnapshot } from '../lib/data/source';
import type { DashboardSnapshot } from '../lib/types';

interface Issue {
  scope: string;
  date: string;
  expected: number;
  actual: number;
}

function sumBy<T extends { date: string }>(rows: T[], field: keyof T): Map<string, number> {
  const result = new Map<string, number>();
  for (const row of rows) {
    result.set(row.date, (result.get(row.date) ?? 0) + (Number(row[field]) || 0));
  }
  return result;
}

function compare(
  scope: string,
  aggregated: Map<string, number>,
  daily: Map<string, number>,
  tolerance: number,
): Issue[] {
  const issues: Issue[] = [];
  for (const [date, actual] of aggregated) {
    const expected = daily.get(date);
    // 明细里有、日报里没有的日期不算错，可能只是两张表覆盖区间不同
    if (expected === undefined) continue;
    if (Math.abs(actual - expected) > Math.max(tolerance, expected * 0.005)) {
      issues.push({ scope, date, expected, actual });
    }
  }
  return issues;
}

function check(snapshot: DashboardSnapshot): Issue[] {
  const dailyGmv = new Map(snapshot.daily.map((row) => [row.date, row.gmv]));
  const dailyOrders = new Map(snapshot.daily.map((row) => [row.date, row.orders]));
  const dailyUv = new Map(snapshot.daily.map((row) => [row.date, row.uv]));

  return [
    ...compare('渠道支付金额', sumBy(snapshot.channels, 'gmv'), dailyGmv, 1),
    ...compare('渠道订单数', sumBy(snapshot.channels, 'orders'), dailyOrders, 1),
    ...compare('渠道访客数', sumBy(snapshot.channels, 'uv'), dailyUv, 1),
    ...compare('商品支付金额', sumBy(snapshot.products, 'gmv'), dailyGmv, 1),
  ];
}

async function main() {
  const snapshot = await getSnapshot();
  console.log(`数据源 ${snapshot.source} · 覆盖 ${snapshot.coverage.from} ~ ${snapshot.coverage.to}`);
  console.log(
    `日报 ${snapshot.daily.length} 行 · 渠道 ${snapshot.channels.length} 行 · ` +
      `商品 ${snapshot.products.length} 行 · 活动 ${snapshot.campaigns.length} 行`,
  );

  const issues = check(snapshot);

  if (issues.length === 0) {
    console.log('');
    console.log('✓ 所有分项之和与大盘一致');
    return;
  }

  console.log('');
  console.log(`✗ ${issues.length} 处对不上（只列前 20 条）：`);
  for (const issue of issues.slice(0, 20)) {
    const diff = issue.actual - issue.expected;
    console.log(
      `    ${issue.date} ${issue.scope}：明细合计 ${issue.actual.toLocaleString('zh-CN')}，` +
        `日报 ${issue.expected.toLocaleString('zh-CN')}，差 ${diff > 0 ? '+' : ''}${diff.toLocaleString('zh-CN')}`,
    );
  }
  console.log('');
  console.log('真实数据出现差异通常是正常的（口径不同、明细表少了某个渠道），');
  console.log('但差得太多就该回飞书表里核对了。');
  process.exitCode = 1;
}

main().catch((err) => {
  console.error('检查失败：', err instanceof Error ? err.message : err);
  process.exit(1);
});
