/**
 * 表头对齐检查：`npm run headers`
 *
 * 把飞书表里的**真实列名**打出来，并逐个字段报告 lib/feishu/mapping.ts 的别名
 * 有没有命中。改别名之前先跑这个，别照着猜。
 *
 * 为什么需要单独一个脚本：别名没命中时 `pick` 返回 undefined、`toNumber` 兜底成 0，
 * 同步不会报错，看板上只是多了一列 0 —— 这种错最难发现，必须显式列出来。
 */

import { readBitableTable } from '../lib/feishu/bitable';
import { isFeishuConfigured, loadFeishuConfig } from '../lib/feishu/config';
import {
  CAMPAIGN_ALIASES,
  CHANNEL_ALIASES,
  DAILY_ALIASES,
  PRODUCT_ALIASES,
  matchHeaders,
  type FieldAliases,
} from '../lib/feishu/mapping';
import { listSheets, readSheetRange } from '../lib/feishu/sheets';
import { resolveSource } from '../lib/feishu/sync';
import { listBitableTables } from '../lib/feishu/bitable';
import { resolveWikiNode } from '../lib/feishu/wiki';
import { loadLocalEnv } from './env';

loadLocalEnv();

type TableKey = 'daily' | 'channels' | 'products' | 'campaigns';

const TABLES: Array<{ key: TableKey; label: string; aliases: FieldAliases<never> }> = [
  { key: 'daily', label: '日报表', aliases: DAILY_ALIASES as FieldAliases<never> },
  { key: 'channels', label: '流量渠道表', aliases: CHANNEL_ALIASES as FieldAliases<never> },
  { key: 'products', label: '商品明细表', aliases: PRODUCT_ALIASES as FieldAliases<never> },
  { key: 'campaigns', label: '活动表', aliases: CAMPAIGN_ALIASES as FieldAliases<never> },
];

async function main() {
  const cfg = loadFeishuConfig();

  if (!isFeishuConfigured(cfg)) {
    console.error('✗ 飞书数据源未配置完整，参考 .env.example 填 .env.local。');
    process.exit(1);
  }

  if (cfg.wikiToken) {
    const node = await resolveWikiNode(cfg, cfg.wikiToken);
    console.log(`· wiki 节点「${node.title}」→ ${node.objType} / ${node.objToken}`);
  }

  const source = await resolveSource(cfg);

  // 先列子表清单，方便照着填 FEISHU_SHEET_* / FEISHU_TABLE_*
  console.log('');
  if (source.docType === 'sheets') {
    console.log('可用子表：');
    for (const sheet of await listSheets(cfg, source.token)) {
      console.log(`    ${sheet.title}  (sheet_id: ${sheet.sheetId}, ${sheet.rowCount} 行)`);
    }
  } else {
    console.log('可用数据表：');
    for (const table of await listBitableTables(cfg, source.token)) {
      console.log(`    ${table.name}  (table_id: ${table.table_id})`);
    }
  }

  let missingTotal = 0;

  for (const { key, label, aliases } of TABLES) {
    const target = source.targets[key];
    console.log('');
    console.log(`── ${label} ${'─'.repeat(Math.max(0, 40 - label.length * 2))}`);

    if (!target) {
      console.log(`   未配置，跳过（要接就填 ${envVarFor(source.docType, key)}）`);
      continue;
    }

    let rows: Array<Record<string, unknown>>;
    try {
      rows =
        source.docType === 'bitable'
          ? await readBitableTable(cfg, source.token, target)
          : await readSheetRange(cfg, source.token, target);
    } catch (err) {
      console.log(`   读取失败：${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    if (rows.length === 0) {
      console.log('   表里没有数据行，读不到表头');
      continue;
    }

    // 只看第一行拿不全列：多维表格的空值字段不会出现在记录里，扫前 50 行做并集
    const headers: string[] = [];
    const seen = new Set<string>();
    for (const row of rows.slice(0, 50)) {
      for (const header of Object.keys(row)) {
        if (!seen.has(header)) {
          seen.add(header);
          headers.push(header);
        }
      }
    }

    console.log(`   真实表头（${headers.length} 列，${rows.length} 行数据）：`);
    console.log(`     ${headers.join(' | ')}`);
    console.log('   字段映射：');

    const matches = matchHeaders(headers, aliases);
    const used = new Set<string>();
    for (const { field, column } of matches) {
      if (column) {
        used.add(column);
        console.log(`     ✓ ${String(field).padEnd(14)} ← 「${column}」`);
      } else {
        missingTotal += 1;
        console.log(`     ✗ ${String(field).padEnd(14)} ← 没有列命中`);
      }
    }

    const unused = headers.filter((header) => !used.has(header));
    if (unused.length > 0) {
      console.log(`   表里还有没被用到的列：${unused.join('、')}`);
    }
  }

  console.log('');
  if (missingTotal === 0) {
    console.log('✓ 所有字段都命中了真实列名，mapping.ts 无需改动');
  } else {
    console.log(`⚠ ${missingTotal} 个字段没有命中任何列。`);
    console.log('  对照上面「没被用到的列」，把真实列名补进 lib/feishu/mapping.ts 的别名数组即可。');
    console.log('  这些字段现在会静默取 0，看板上会显示成 0 而不是报错。');
  }
}

function envVarFor(docType: 'sheets' | 'bitable', key: TableKey): string {
  const suffix = key.toUpperCase();
  return docType === 'sheets' ? `FEISHU_SHEET_${suffix}` : `FEISHU_TABLE_${suffix}`;
}

main().catch((err) => {
  console.error('');
  console.error('✗ 检查失败：', err instanceof Error ? err.message : err);
  console.error('');
  console.error('如果报的是 99991672 / Access denied，说明应用没开对应只读权限：');
  console.error('  wiki:wiki:readonly、sheets:spreadsheet:readonly、drive:drive:readonly');
  console.error('  （多维表格再加 bitable:app:readonly）');
  console.error('开放平台「权限管理」勾选后，必须「创建版本并发布」才生效。');
  process.exit(1);
});
