/**
 * 生成可托管的静态看板：`npm run build:static`
 *
 * 预览页 `preview/dashboard.html` 是一个自包含的单文件应用，数据以
 * `const DATA = {...};` 的形式内联在里面。这个脚本把里面那份数据换成**当前**
 * 数据源导出的结果，产物写到 `dist/index.html`，可以直接丢给任何静态托管。
 *
 * 配了飞书就现拉一次；没配就用仓库里已有的快照 / 演示数据 —— 也就是说
 * 没有凭据时它仍然能跑通，只是数据停在上一次同步。
 *
 * 为什么不直接把 preview/dashboard.html 托管出去：那份文件里的数据是提交那一刻
 * 的，谁改了页面不重新导出，线上就会长期停在旧数字上，而页面顶部还写着「数据截至」。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildPayload } from './payload';
import { loadLocalEnv } from './env';

loadLocalEnv();

const MARK = 'const DATA = ';

async function main() {
  const src = resolve(process.cwd(), 'preview/dashboard.html');
  const out = resolve(process.cwd(), process.argv[2] ?? 'dist/index.html');

  const html = readFileSync(src, 'utf8');
  const start = html.indexOf(MARK);
  if (start < 0) throw new Error(`${src} 里找不到 "${MARK}"，页面结构变了`);
  // DATA 是压缩成一行的 JSON，所以它后面第一个 "};" 就是结尾，不会误伤
  const from = start + MARK.length;
  const end = html.indexOf('};', from);
  if (end < 0) throw new Error('找不到 DATA 的结尾，页面结构变了');

  const { payload, source, latestDate } = await buildPayload();
  const next = html.slice(0, from) + JSON.stringify(payload) + html.slice(end + 1);

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, next, 'utf8');

  const kb = Math.round(next.length / 1024);
  console.log(`✓ 生成 ${out}（${kb} KB，来源 ${source}，截至 ${latestDate}）`);
  if (source === 'mock') {
    console.log('⚠ 当前是演示数据。要出真实数据，请配好 FEISHU_* 环境变量再跑一次。');
  }
}

main().catch((err) => {
  console.error('构建失败：', err instanceof Error ? err.message : err);
  process.exit(1);
});
