/**
 * 表头对齐检查：`npm run headers`
 *
 * 把飞书表里的**真实列名**打出来，并逐个字段报告 lib/feishu/mapping.ts 的别名
 * 有没有命中。改别名之前先跑这个，别照着猜。
 *
 * 为什么需要单独一个脚本：别名没命中时 `pick` 返回 undefined、`toNumber` 兜底成 0，
 * 同步不会报错，看板上只是多了一列 0 —— 这种错最难发现，必须显式列出来。
 */

import { listBitableTables } from '../lib/feishu/bitable';
import {
  TABLE_ENV_SUFFIX,
  TABLE_KEYS,
  TABLE_LABELS,
  isFeishuConfigured,
  loadFeishuConfig,
  type TableKey,
} from '../lib/feishu/config';
import {
  AD_ALIASES,
  DAILY_ALIASES,
  KEYWORD_ALIASES,
  PRODUCT_ALIASES,
  TARGET_ALIASES,
  matchHeaders,
  type AliasMap,
} from '../lib/feishu/mapping';
import { listSheets } from '../lib/feishu/sheets';
import { readTable, resolveSource } from '../lib/feishu/sync';
import { resolveWikiNode } from '../lib/feishu/wiki';
import { loadLocalEnv } from './env';

loadLocalEnv();

const ALIASES: Record<TableKey, AliasMap> = {
  daily: DAILY_ALIASES,
  adsInsite: AD_ALIASES,
  adsOffsite: AD_ALIASES,
  products: PRODUCT_ALIASES,
  keywords: KEYWORD_ALIASES,
  targets: TARGET_ALIASES,
};

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

  for (const key of TABLE_KEYS) {
    const label = TABLE_LABELS[key];
    const target = source.targets[key];
    console.log('');
    console.log(`── ${label} ${'─'.repeat(Math.max(0, 40 - label.length * 2))}`);

    if (!target) {
      const prefix = source.docType === 'sheets' ? 'FEISHU_SHEET_' : 'FEISHU_TABLE_';
      console.log(`   未配置，跳过（要接就填 ${prefix}${TABLE_ENV_SUFFIX[key]}）`);
      continue;
    }

    let rows: Array<Record<string, unknown>>;
    try {
      rows = await readTable(cfg, source, target);
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

    const matches = matchHeaders(headers, ALIASES[key]);
    const used = new Set<string>();
    for (const { field, column } of matches) {
      if (column) {
        used.add(column);
        console.log(`     ✓ ${field.padEnd(18)} ← 「${column}」`);
      } else {
        missingTotal += 1;
        console.log(`     ✗ ${field.padEnd(18)} ← 没有列命中`);
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
    console.log('  部分是正常的 —— 辅助列（客退率 / 站内ROI 等）只在表里没有绝对值列时才需要。');
    console.log('  对照上面「没被用到的列」，把真实列名补进 lib/feishu/mapping.ts 的别名数组即可。');
  }
}

main().catch((err) => {
  console.error('');
  console.error('✗ 检查失败：', err instanceof Error ? err.message : err);
  console.error('');
  console.error('如果报的是 99991672 / Access denied，说明应用没开对应只读权限：');
  console.error('  wiki:wiki:readonly、sheets:spreadsheet:readonly、drive:drive:readonly');
  console.error('  （多维表格再加 bitable:app:readonly）');
  console.error('如果报的是 131006 / permission denied，权限开了但应用没被加进知识库成员。');
  process.exit(1);
});
