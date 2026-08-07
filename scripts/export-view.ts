/**
 * 导出看板视图数据：`npm run export`
 *
 * 把 buildView 的结果落成一份 JSON，供静态预览页内联使用。
 * 预览页和 Next 应用共用同一套指标逻辑，数字不会两边对不上。
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getSnapshot } from '../lib/data/source';
import { buildView } from '../lib/metrics';
import { loadLocalEnv } from './env';

loadLocalEnv();

async function main() {
  const snapshot = await getSnapshot();
  const view = buildView(snapshot, null);

  const payload = {
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
