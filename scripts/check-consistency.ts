/**
 * 数据一致性自检：`npm run check`
 *
 * 检查分项之和是否等于大盘 —— 商品明细的 GMV 加起来必须等于日报的 GMV，
 * 投放明细的消耗加起来必须等于日报的投放费。运营核对时第一个发现的就是这类
 * 对不上，一旦对不上，之后整个看板的数字都不会有人再信。
 *
 * 默认检查当前数据源（有快照读快照，否则用 mock）。
 */

import { getSnapshot } from '../lib/data/source';
import type { DashboardSnapshot } from '../lib/types';
import { loadLocalEnv } from './env';

loadLocalEnv();

interface Issue {
  scope: string;
  date: string;
  expected: number;
  actual: number;
}

function sumByDate<T extends { date: string }>(rows: T[], pick: (row: T) => number): Map<string, number> {
  const result = new Map<string, number>();
  for (const row of rows) {
    result.set(row.date, (result.get(row.date) ?? 0) + (pick(row) || 0));
  }
  return result;
}

function compare(
  scope: string,
  aggregated: Map<string, number>,
  baseline: Map<string, number>,
  tolerance: number,
): Issue[] {
  const issues: Issue[] = [];
  for (const [date, actual] of aggregated) {
    const expected = baseline.get(date);
    // 明细里有、日报里没有的日期不算错，可能只是两张表覆盖区间不同
    if (expected === undefined) continue;
    if (Math.abs(actual - expected) > Math.max(tolerance, expected * 0.005)) {
      issues.push({ scope, date, expected, actual });
    }
  }
  return issues;
}

function check(snapshot: DashboardSnapshot): Issue[] {
  const dailyGmv = sumByDate(snapshot.daily, (row) => row.gmv);
  const dailyAdCost = sumByDate(snapshot.daily, (row) => row.adCostInsite + row.adCostOffsite);

  return [
    ...compare('商品 GMV', sumByDate(snapshot.products, (row) => row.gmv), dailyGmv, 1),
    ...compare('投放消耗', sumByDate(snapshot.ads, (row) => row.cost), dailyAdCost, 1),
    /**
     * 流量来源不参与对账。
     *
     * 真表里「总搜索」和一级来源「搜索」是两个口径：前者含付费关键词，后者只算自然搜索；
     * 六路来源之和也不等于总访客（同一个人可能从多个入口进来，还有没被归类的）。
     * 这不是数据错，是平台报表本来就这么给的 —— 所以页面上占比的分母用的是
     * 「这几路的合计」，而不是总 UV。硬拿它们对账只会天天报假警。
     */
    ...checkPaidUv(snapshot),
  ];
}

/**
 * 付费 UV 检查的是**上界**，不是等式。
 *
 * 付费 UV 是「进店的独立访客」，点击是「点了几次」—— 一个人点两次算两次点击、
 * 一个访客，所以点击必然 ≥ 付费 UV，两者不可能相等。同理付费访客是总访客的
 * 子集。只卡这两条上界：
 *   付费 UV ≤ 总点击   超了说明把点击当访客数了
 *   付费 UV ≤ 总访客   超了说明把站外平台的人也算进店铺访客了
 * 后一条正是之前 mock 里把站外点击 1:1 计入时踩到的坑 —— 占比能到 101%。
 */
function checkPaidUv(snapshot: DashboardSnapshot): Issue[] {
  const clicks = sumByDate(snapshot.ads, (row) => row.clicks);
  const issues: Issue[] = [];
  for (const row of snapshot.daily) {
    const totalClicks = clicks.get(row.date) ?? 0;
    if (totalClicks > 0 && row.paidUv > totalClicks * 1.02) {
      issues.push({ scope: '付费 UV 超过总点击', date: row.date, expected: totalClicks, actual: row.paidUv });
    }
    if (row.paidUv > row.uv) {
      issues.push({ scope: '付费 UV 超过总访客', date: row.date, expected: row.uv, actual: row.paidUv });
    }
  }
  return issues;
}

async function main() {
  const snapshot = await getSnapshot();

  console.log(`数据源 ${snapshot.source}，覆盖 ${snapshot.coverage.from} ~ ${snapshot.coverage.to}`);
  console.log(
    `  日报 ${snapshot.daily.length} 行 · 投放 ${snapshot.ads.length} 行 · ` +
      `商品 ${snapshot.products.length} 行 · 流量来源 ${snapshot.trafficChannels.length} 行 · ` +
      `目标 ${snapshot.targets.length} 行`,
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
