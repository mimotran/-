/**
 * 拉「排查记录」并落盘 / 连通性自检：`npm run sync:links`
 *
 * 它会把每一步都打出来 —— 工作簿里有哪些子表、选中了哪一个、每个字段落到了哪一列、
 * 解析出多少行、最新一天的五个指标各是多少。表头对不齐时看这份报告比盯着页面猜快得多。
 *
 * 最后那段「最新一天的五个指标」就是**对账用的参照**：页面默认视图（最新排查日期、
 * 其余筛选全部）算出来的五个数必须和它一模一样，对不上说明页面和 lib 走样了。
 */

import { loadFeishuConfig } from '../lib/feishu/config';
import { isLowPriceConfigured, loadLowPriceSource, syncLinks } from '../lib/lowprice/feishu';
import { LINK_ALIASES } from '../lib/lowprice/parse';
import { applyFilters, latestDate, summarize } from '../lib/lowprice/rules.js';
import { snapshotPath, writeLinkSnapshot } from '../lib/lowprice/snapshot';
import { loadLocalEnv } from './env';

loadLocalEnv();

async function main() {
  const cfg = loadFeishuConfig();
  const source = loadLowPriceSource();

  if (!isLowPriceConfigured(cfg)) {
    console.error('✗ 飞书凭证未配置。需要 FEISHU_APP_ID 和 FEISHU_APP_SECRET，参考 .env.example。');
    process.exit(1);
  }

  console.log(`· 开放平台地址 ${cfg.baseUrl}`);
  console.log(`· App ID ${cfg.appId}`);
  console.log(`· 工作簿 ${source.spreadsheetToken}${source.sheet ? ` / 子表 ${source.sheet}` : ''}`);

  const snapshot = await syncLinks(cfg);

  console.log('✓ 工作簿子表：');
  for (const sheet of snapshot.sheets) {
    const mark = sheet.title === snapshot.sheetTitle ? '→' : ' ';
    console.log(`  ${mark} ${sheet.title}  (sheet_id: ${sheet.sheetId}, ${sheet.rowCount} 行)`);
  }

  console.log('');
  console.log('✓ 表头对齐（字段 → 源表列名）：');
  for (const field of Object.keys(LINK_ALIASES)) {
    const column = snapshot.parse.headerMap[field];
    console.log(`    ${field.padEnd(13)} ${column ?? '—— 没找到，解析时留空'}`);
  }

  const rows = snapshot.rows;
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  console.log('');
  console.log(`✓ 解析 ${rows.length} 行（跳过 ${snapshot.parse.skipped} 行）`);
  console.log(
    `  排查日期 ${dates.length} 天：${dates[0] ?? '—'} ~ ${dates[dates.length - 1] ?? '—'}`,
  );

  const latest = latestDate(rows);
  const today = applyFilters(rows, { dateFrom: latest, dateTo: latest });
  const s = summarize(today);
  console.log('');
  console.log(`✓ 最新一天 ${latest || '—'} 的五个指标（页面默认视图应当与此完全一致）：`);
  console.log(`    在架链接 ${s.records}（去重 ${s.links} 条链接）`);
  console.log(`    低价链接 ${s.low}`);
  console.log(`    低价占比 ${(s.lowRate * 100).toFixed(1)}%`);
  console.log(`    涉及店铺 ${s.shops}`);
  console.log(`    严重低价 ${s.severe}（其中疑似异常价格 ${s.abnormal}）`);

  const persisted = await writeLinkSnapshot({
    rows: snapshot.rows,
    source: snapshot.source,
    syncedAt: snapshot.syncedAt,
    docUrl: snapshot.docUrl,
    sheetTitle: snapshot.sheetTitle,
    warnings: snapshot.warnings,
  });
  console.log('');
  console.log(`  落盘 ${persisted ? snapshotPath() : '失败（只读文件系统？不影响本次构建）'}`);

  if (snapshot.warnings.length) {
    console.log('');
    console.log(`⚠ ${snapshot.warnings.length} 条告警：`);
    for (const warning of snapshot.warnings) console.log(`    ${warning}`);
  }
}

main().catch((err) => {
  console.error('');
  console.error('✗ 同步失败：', err instanceof Error ? err.message : err);
  console.error('');
  console.error('常见原因：');
  console.error('  · 应用没被加进这个工作簿的协作者 → 打开表格「···」→ 添加文档应用');
  console.error('  · 权限没开或没发版 → 开放平台勾选 sheets:spreadsheet:readonly 后创建版本并发布');
  console.error('  · 出网被拦（报错里出现 403 / 不是 JSON）→ 运行环境要放行 open.feishu.cn');
  process.exit(1);
});
