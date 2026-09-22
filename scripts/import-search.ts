/**
 * 把淘宝 / 京东搜索页的「另存为完整网页」导入「排查登记表」：
 *
 *   npm run import:search -- <文件...>              只解析并打印，不写表（默认）
 *   npm run import:search -- <文件...> --write      确认无误后写入飞书
 *
 * 其他参数：
 *   --date=2026-09-22      排查日期，默认今天
 *   --exclude=A,B          按店名排除，默认排除「PLAUD旗舰店」
 *
 * **为什么一定要先看一遍再 --write**：搜索页展示的是最低 SKU 价，不一定是整机价。
 * 历史上那几行 ¥158 / ¥189 的「严重低价」就是这么来的 —— 实际整机价是 ¥1508 / ¥1472。
 * 脚本会把这类行标出来，但判断只能靠人点进商品页看。
 */

import { readFileSync } from 'node:fs';
import { feishuGet, feishuPut } from '../lib/feishu/client';
import { loadFeishuConfig, type FeishuConfig } from '../lib/feishu/config';
import { classify, type KeptRow } from '../lib/lowprice/import/classify';
import { parseJdSearch } from '../lib/lowprice/import/jd';
import { parseTaobaoSearch } from '../lib/lowprice/import/taobao';
import type { RawItem } from '../lib/lowprice/import/types';
import { DEFAULT_SPREADSHEET_TOKEN, loadLowPriceSource } from '../lib/lowprice/feishu';
import { ABNORMAL_RATE } from '../lib/lowprice/rules.js';
import { loadLocalEnv } from './env';

loadLocalEnv();

const LOG_SHEET = '1WDztC'; // 排查登记表
const KNOCKOFF_SHEET = '1XSBiM'; // 同款仿品与蹭词
const SHOP_SHEET = '1Xk4Ba'; // 店铺汇总

/** 排查登记表的列序。对不上就中止 —— 列序变了还硬写等于把数据错位灌进去。 */
const LOG_COLUMNS = [
  '序号', '排查日期', '平台', '卖家昵称', '卖家ID/UID', '店铺类型', '商品链接URL', '店铺链接',
  '产品型号', '版本', '违规售价', '官方指导价', '价差(元)', '低价幅度', '月销', '发货地', '备注',
];
const KNOCKOFF_COLUMNS = ['平台', '卖家昵称', '商品标题', '售价', '商品链接URL', '判定'];

type Cell = string | number | { type: 'url'; text: string; link: string };

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const text = (cell: unknown): string =>
  Array.isArray(cell)
    ? cell.map((c) => (c as { text?: string }).text ?? '').join('')
    : cell == null
      ? ''
      : String(cell).trim();

const linkCell = (url: string): Cell => (url ? { type: 'url', text: url, link: url } : '');

/** 按内容判断这是淘宝页还是京东页 —— 文件名不可靠，用户另存时会随手改 */
function parseFile(path: string): RawItem[] {
  const html = readFileSync(path, 'utf8');
  if (/\bid="item_id_\d+"/.test(html)) return parseTaobaoSearch(html);
  if (/data-item="/.test(html)) return parseJdSearch(html);
  throw new Error(`${path} 既不像淘宝搜索页也不像京东搜索页，认不出结构`);
}

/**
 * 读一段区间，并把**末尾的空行截掉**。
 *
 * 飞书会把请求区间里的空行原样返回 —— 问 A1:Q20000 就还你 20000 行。
 * 拿 values.length 当「最后一行」会把新数据写到第 20001 行去（踩过一次）。
 */
async function readRange(cfg: FeishuConfig, token: string, range: string): Promise<unknown[][]> {
  const data = await feishuGet<{ valueRange?: { values?: unknown[][] } }>(
    `/sheets/v2/spreadsheets/${token}/values/${encodeURIComponent(range)}`,
    {},
    cfg,
  );
  const values = data.valueRange?.values ?? [];
  let last = values.length;
  while (last > 0 && (values[last - 1] ?? []).every((cell) => text(cell) === '')) last -= 1;
  return values.slice(0, last);
}

function requireColumns(header: string[], expected: string[], sheet: string): void {
  const actual = header.slice(0, expected.length).join('|');
  if (actual !== expected.join('|')) {
    throw new Error(
      `「${sheet}」的列序和预期不一致，已中止（没有写入任何数据）。\n  预期：${expected.join(' | ')}\n  实际：${header.join(' | ')}`,
    );
  }
}

/**
 * 京东卡片给的是累计评价（1万+ / 500+），不是月销；既有数据里也是把热度写在这一列。
 * 「1万+」原样写进去会被解析器读成 1，先换算成数字。
 */
function jdHeat(raw: string): string {
  if (!raw) return '';
  const m = raw.match(/^([\d.]+)(万)?(\+)?$/);
  if (!m) return `${raw}人评价`;
  return `${Math.round(Number(m[1]) * (m[2] ? 10000 : 1))}${m[3] ?? ''}人评价`;
}

function guessShopType(item: RawItem): string {
  if (item.platform === '京东') {
    if (item.isSelfRun) return '京东自营';
    return /专营/.test(item.shop) ? '京东专营店' : '京东POP店';
  }
  return /企业店/.test(item.shop) ? '淘宝企业店铺' : '淘宝个人店铺(C店)';
}

const width = (s: string) =>
  [...s].reduce((n, c) => n + (/[一-鿿＀-￯　-〿]/.test(c) ? 2 : 1), 0);
const pad = (s: unknown, n: number) => String(s) + ' '.repeat(Math.max(1, n - width(String(s))));

async function main() {
  const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (files.length === 0) {
    console.error('用法：npm run import:search -- <搜索页.html...> [--write] [--date=YYYY-MM-DD] [--exclude=店名,店名]');
    process.exit(1);
  }

  const write = process.argv.includes('--write');
  const date = arg('date', new Date().toISOString().slice(0, 10));
  const excludeShops = arg('exclude', 'PLAUD旗舰店').split(',').filter(Boolean);

  // 同一个商品会在多页重复出现，按 平台+ID 去重
  const seen = new Map<string, RawItem>();
  for (const file of files) {
    const items = parseFile(file);
    let added = 0;
    for (const item of items) {
      const key = `${item.platform}|${item.id}`;
      if (!seen.has(key)) { seen.set(key, item); added += 1; }
    }
    console.log(`· ${file.split('/').pop()}  解析 ${items.length} 条，新增 ${added} 条`);
  }

  const result = classify([...seen.values()], { excludeShops });
  console.log('');
  console.log(`✓ 排查登记表 ${result.keep.length} 条 | 蹭词仿品 ${result.knockoff.length} 条 | 剔除 ${result.drop.length} 条`);

  const dropReasons = new Map<string, number>();
  for (const d of result.drop) dropReasons.set(d.reason, (dropReasons.get(d.reason) ?? 0) + 1);
  for (const [reason, n] of [...dropReasons].sort((a, b) => b[1] - a[1])) {
    console.log(`    剔除：${pad(reason, 30)} ${n} 条`);
  }

  console.log('');
  console.log(pad('平台', 6) + pad('店铺', 28) + pad('型号', 18) + pad('版本', 8) + pad('售价', 11) + '低价幅度');
  const sorted = [...result.keep].sort((a, b) => (b.rate ?? -99) - (a.rate ?? -99));
  for (const row of sorted) {
    const flag = row.rate !== null && row.rate >= ABNORMAL_RATE ? '  ⚠ 疑似最低 SKU 价，需人工复核' : '';
    console.log(
      pad(row.item.platform, 6) + pad(row.item.shop, 28) + pad(row.model || '(待定)', 18) +
        pad(row.version || '—', 8) + pad('¥' + row.price, 11) +
        pad(row.rate === null ? '待定' : (row.rate * 100).toFixed(1) + '%', 9) + flag,
    );
  }

  const abnormal = result.keep.filter((r) => r.rate !== null && r.rate >= ABNORMAL_RATE);
  if (abnormal.length) {
    console.log('');
    console.log(`⚠ ${abnormal.length} 条低价幅度 ≥ ${ABNORMAL_RATE * 100}%，几乎可以肯定是最低 SKU 价而不是整机价。`);
    console.log('  写入后请点进这几个商品页核实真实整机价，改完重新跑 npm run sync:links。');
  }

  if (!write) {
    console.log('');
    console.log('（未加 --write，以上只是解析结果，没有写入表格）');
    return;
  }

  // --- 写入 ------------------------------------------------------------------
  const cfg = loadFeishuConfig();
  const token = loadLowPriceSource().spreadsheetToken || DEFAULT_SPREADSHEET_TOKEN;

  const log = await readRange(cfg, token, `${LOG_SHEET}!A1:Q20000`);
  requireColumns(log[0]?.map(text) ?? [], LOG_COLUMNS, '排查登记表');

  const shops = await readRange(cfg, token, `${SHOP_SHEET}!A1:J20000`);
  const shopHeader = shops[0]?.map(text) ?? [];
  const col = (name: string) => shopHeader.indexOf(name);
  const profiles = new Map<string, { sellerId: string; shopType: string; shopUrl: string }>();
  for (const row of shops.slice(1)) {
    profiles.set(`${text(row[col('平台')])}|${text(row[col('卖家昵称')])}`, {
      sellerId: text(row[col('卖家ID/UID')]),
      shopType: text(row[col('店铺类型')]),
      shopUrl: text(row[col('店铺链接')]),
    });
  }

  const firstRow = log.length + 1;
  let seq = Math.max(0, ...log.slice(1).map((r) => Number(text(r[0])) || 0)) + 1;
  const noteBase = `本行由 ${date} 淘宝/京东搜索页存档自动导入；售价取自搜索页展示价（可能是最低 SKU，非整机价），需人工复核`;

  const toRow = (r: KeptRow): Cell[] => {
    const p = profiles.get(`${r.item.platform}|${r.item.shop}`);
    return [
      seq++, date, r.item.platform, r.item.shop,
      p?.sellerId ?? '', p?.shopType || guessShopType(r.item),
      linkCell(r.item.url), linkCell(p?.shopUrl ?? ''),
      r.model, r.version, r.price, r.listPrice ?? '',
      r.gap === null ? '' : Number(r.gap.toFixed(2)),
      r.rate === null ? '' : Number(r.rate.toFixed(6)),
      r.item.platform === '淘宝' ? r.item.salesText : jdHeat(r.item.heatText ?? ''),
      r.item.region,
      [noteBase, r.review, `原标题：${r.item.title}`].filter(Boolean).join('；'),
    ];
  };
  const rows = result.keep.map(toRow);

  await feishuPut(`/sheets/v2/spreadsheets/${token}/values`, {
    valueRange: { range: `${LOG_SHEET}!A${firstRow}:Q${firstRow + rows.length - 1}`, values: rows },
  }, cfg);
  console.log('');
  console.log(`✓ 排查登记表写入 ${rows.length} 行（A${firstRow}:Q${firstRow + rows.length - 1}，序号 ${rows[0][0]}–${rows[rows.length - 1][0]}）`);

  if (result.knockoff.length) {
    const knock = await readRange(cfg, token, `${KNOCKOFF_SHEET}!A1:F20000`);
    requireColumns(knock[0]?.map(text) ?? [], KNOCKOFF_COLUMNS, '同款仿品与蹭词');
    const start = knock.length + 1;
    const values: Cell[][] = result.knockoff.map(({ item, reason }) => [
      item.platform, item.shop, item.title, item.price as number, linkCell(item.url), reason,
    ]);
    await feishuPut(`/sheets/v2/spreadsheets/${token}/values`, {
      valueRange: { range: `${KNOCKOFF_SHEET}!A${start}:F${start + values.length - 1}`, values },
    }, cfg);
    console.log(`✓ 同款仿品与蹭词写入 ${values.length} 行（A${start}:F${start + values.length - 1}）`);
  }

  console.log('');
  console.log('接下来：npm run sync:links 把看板数据刷新一遍。');
}

main().catch((err) => {
  console.error('');
  console.error('✗ 导入失败：', err instanceof Error ? err.message : err);
  process.exit(1);
});
