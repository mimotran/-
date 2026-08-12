/**
 * 导出看板视图数据：`npm run export`
 *
 * 把 buildView 的结果落成一份 JSON，供静态预览页内联使用。
 * 预览页和 Next 应用共用同一套指标逻辑，数字不会两边对不上。
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildPayload } from './payload';
import { loadLocalEnv } from './env';

loadLocalEnv();

async function main() {
  const { payload, source, latestDate } = await buildPayload();

  const out = resolve(process.cwd(), process.argv[2] ?? 'view.json');
  writeFileSync(out, JSON.stringify(payload), 'utf8');

  const kb = Math.round(JSON.stringify(payload).length / 1024);
  console.log(`✓ 导出 ${out}（${kb} KB，来源 ${source}，截至 ${latestDate}）`);
}

main().catch((err) => {
  console.error('导出失败：', err instanceof Error ? err.message : err);
  process.exit(1);
});
