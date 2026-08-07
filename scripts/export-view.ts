/**
 * 导出看板视图数据：`npm run export`
 *
 * 把 buildView 的结果落成一份 JSON，供静态预览页内联使用。
 * 预览页和 Next 应用共用同一套指标逻辑，数字不会两边对不上。
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getSnapshot } from '../lib/data/source';
import { STORE_CORE, STORE_EXTRA, buildView } from '../lib/metrics';
import { loadLocalEnv } from './env';

loadLocalEnv();

async function main() {
  const snapshot = await getSnapshot();
  const view = buildView(snapshot, null);

  /**
   * 日序列按列存，不按行。
   *
   * 583 天 × 14 个字段，用对象数组是 `{"date":"2025-01-01","gmv":41234,...}` 重复
   * 583 遍键名；按列存只写一遍键名 + 一串数字，体积差三倍多。
   * 预览页要靠它算任意自定义区间。
   */
  const dailyKeys = [
    'gmv', 'deviceSales', 'gmvAfterRefund', 'refund', 'uv', 'searchUv',
    'buyers', 'orders', 'addToCart', 'newCustomerGmv',
    'adCostInsite', 'adCostOffsite', 'adGmvInsite', 'adGmvOffsite',
    'searchOrders', 'grossProfit',
  ] as const;

  const daily = {
    dates: snapshot.daily.map((row) => row.date),
    cols: Object.fromEntries(
      dailyKeys.map((key) => [key, snapshot.daily.map((row) => Math.round(row[key]))]),
    ),
  };

  /** 指标定义随数据一起导出：预览页只按 key 取值，不重复维护一份标签表 */
  const spec = (list: typeof STORE_CORE) =>
    list.map((m) => ({ key: m.key, label: m.label, format: m.format, higherIsBetter: m.higherIsBetter }));

  const payload = {
    daily,
    storeMetrics: { core: spec(STORE_CORE), extra: spec(STORE_EXTRA) },
    source: snapshot.source,
    syncedAt: snapshot.syncedAt,
    latestDate: view.latestDate,
    earliestDate: view.earliestDate,
    // 周期与 KPI：只留展示需要的字段，别把整份聚合塞进页面
    stats: view.stats.map((stat) => ({
      key: stat.period.key,
      label: stat.period.label,
      compareLabel: stat.period.compareLabel,
      range: stat.period.range,
      compareRange: stat.period.compareRange,
      core: stat.core,
      extra: stat.extra,
      ads: stat.ads,
      aggregate: stat.aggregate,
    })),
    goals: view.goals,
    trend: view.trend,
    trendRange: view.trendRange,
    insite: view.insite,
    offsite: view.offsite,
    products: view.products,
    keywords: view.keywords,
    breakdownLabel: view.breakdownPeriod.label,
    breakdownRange: view.breakdownPeriod.range,
  };

  const out = resolve(process.cwd(), process.argv[2] ?? 'view.json');
  writeFileSync(out, JSON.stringify(payload), 'utf8');

  const kb = Math.round(JSON.stringify(payload).length / 1024);
  console.log(`✓ 导出 ${out}（${kb} KB，来源 ${snapshot.source}，截至 ${view.latestDate}）`);
}

main().catch((err) => {
  console.error('导出失败：', err instanceof Error ? err.message : err);
  process.exit(1);
});
