/**
 * 本地同步 / 连通性自检：`npm run sync`
 *
 * 配完飞书凭证后先跑这个 —— 它会把每一步（拿 token、解析 wiki 节点、列子表、
 * 读数据、解析字段）的结果打出来，比对着看板猜哪里错了快得多。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeSnapshot } from '../lib/data/snapshot';
import { isFeishuConfigured, loadFeishuConfig } from '../lib/feishu/config';
import { listBitableTables } from '../lib/feishu/bitable';
import { listSheets } from '../lib/feishu/sheets';
import { resolveSource, syncFromFeishu } from '../lib/feishu/sync';
import { resolveWikiNode } from '../lib/feishu/wiki';

loadEnvFile('.env.local');
loadEnvFile('.env');

async function main() {
  const cfg = loadFeishuConfig();

  if (!isFeishuConfigured(cfg)) {
    console.error('✗ 飞书数据源未配置完整。');
    console.error('  需要 FEISHU_APP_ID、FEISHU_APP_SECRET，以及 FEISHU_WIKI_TOKEN');
    console.error('  （或 FEISHU_SPREADSHEET_TOKEN / FEISHU_BITABLE_APP_TOKEN）之一。');
    console.error('  参考 .env.example。');
    process.exit(1);
  }

  console.log(`· 开放平台地址 ${cfg.baseUrl}`);
  console.log(`· App ID ${cfg.appId}`);

  if (cfg.wikiToken) {
    const node = await resolveWikiNode(cfg, cfg.wikiToken);
    console.log(`✓ wiki 节点「${node.title}」→ ${node.objType} / ${node.objToken}`);
  }

  // 先把可选的子表清单打出来，方便照着填 FEISHU_SHEET_* / FEISHU_TABLE_*
  const source = await resolveSource(cfg);
  if (source.docType === 'sheets') {
    const sheets = await listSheets(cfg, source.token);
    console.log('✓ 电子表格子表：');
    for (const sheet of sheets) {
      console.log(`    ${sheet.title}  (sheet_id: ${sheet.sheetId}, ${sheet.rowCount} 行)`);
    }
  } else {
    const tables = await listBitableTables(cfg, source.token);
    console.log('✓ 多维表格数据表：');
    for (const table of tables) {
      console.log(`    ${table.name}  (table_id: ${table.table_id})`);
    }
  }

  const snapshot = await syncFromFeishu(cfg);
  const persisted = await writeSnapshot(snapshot);

  console.log('');
  console.log(`✓ 同步完成，来源 ${snapshot.source}`);
  console.log(`  覆盖 ${snapshot.coverage.from} ~ ${snapshot.coverage.to}`);
  console.log(
    `  日报 ${snapshot.daily.length} 行 · 渠道 ${snapshot.channels.length} 行 · ` +
      `商品 ${snapshot.products.length} 行 · 活动 ${snapshot.campaigns.length} 行`,
  );
  console.log(`  落盘 ${persisted ? '成功' : '失败（只读文件系统？看板仍可运行，但每次都要重新拉取）'}`);

  if (snapshot.warnings.length > 0) {
    console.log('');
    console.log(`⚠ ${snapshot.warnings.length} 条告警：`);
    for (const warning of snapshot.warnings) console.log(`    ${warning}`);
  }
}

/** 极简 .env 解析，避免为一个脚本引入 dotenv */
function loadEnvFile(filename: string): void {
  try {
    const content = readFileSync(resolve(process.cwd(), filename), 'utf8');
    for (const line of content.split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const value = match[2].replace(/^["']|["']$/g, '');
      // 已经存在的环境变量优先，方便 CI 里覆盖
      if (process.env[match[1]] === undefined) process.env[match[1]] = value;
    }
  } catch {
    // 文件不存在很正常，忽略
  }
}

main().catch((err) => {
  console.error('');
  console.error('✗ 同步失败：', err instanceof Error ? err.message : err);
  console.error('');
  console.error('常见原因：');
  console.error('  · 应用没被加进知识库/文档的协作者 → 打开文档「···」→ 添加文档应用');
  console.error('  · 权限没开或没发版 → 开放平台「权限管理」勾选只读权限后创建版本并发布');
  console.error('  · wiki token 当成了 spreadsheet token → 用 FEISHU_WIKI_TOKEN 而不是 FEISHU_SPREADSHEET_TOKEN');
  process.exit(1);
});
