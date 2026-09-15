/**
 * 链接明细页对账：`npm run check:links [页面路径]`
 *
 * 页面上的数字全是在浏览器里现算的，所以必须证明「页面里跑的那段口径」和
 * 「lib 里跑的那段口径」是同一份、且算出来一模一样。做法是把产物 HTML 里注入的
 * rules 块抠出来，在 Node 里跑一遍，和直接 import lib/lowprice/rules.js 的结果逐格比。
 *
 * 比的不只是总数：日期 × 平台 × 型号 × 是否低价 等组合各算一遍五个指标，
 * 外加每一行的风险等级和低价幅度 —— 只比总数的话，一个只影响某个分支的改动照样溜过去。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as lib from '../lib/lowprice/rules.js';
import type { LinkRecord } from '../lib/lowprice/types';

const RULES_BEGIN = '/* __RULES_BEGIN__ */';
const RULES_END = '/* __RULES_END__ */';
const DATA_MARK = 'const DATA = ';

type Rules = typeof lib;

/** 从产物 HTML 里抠出 rules 块，包成模块再 new Function 出来 */
function extractRules(html: string): Rules {
  const start = html.indexOf(RULES_BEGIN);
  const end = html.indexOf(RULES_END);
  if (start < 0 || end < 0) throw new Error('页面里找不到 rules 块 —— build-links 没有注入？');
  const code = html.slice(start + RULES_BEGIN.length, end);
  if (!/function\s+getDiscountRate/.test(code)) {
    throw new Error('rules 块里没有 getDiscountRate —— 注入的内容不对');
  }
  const names = Object.keys(lib);
  const factory = new Function(`${code}\nreturn { ${names.join(', ')} };`);
  return factory() as Rules;
}

function extractData(html: string): { rows: LinkRecord[]; latestDate: string } {
  const start = html.indexOf(DATA_MARK);
  if (start < 0) throw new Error('页面里找不到 DATA');
  const from = start + DATA_MARK.length;
  const end = html.indexOf('};', from);
  return JSON.parse(html.slice(from, end + 1));
}

function main() {
  const file = resolve(process.cwd(), process.argv[2] ?? 'dist/links.html');
  const html = readFileSync(file, 'utf8');
  const page = extractRules(html);
  const { rows } = extractData(html);

  console.log(`· 对账目标 ${file}`);
  console.log(`· 页面内数据 ${rows.length} 行`);

  // 1. 源码一致性：页面里的 rules 必须就是 lib/lowprice/rules.js 去掉 export 的样子
  const source = readFileSync(resolve(process.cwd(), 'lib/lowprice/rules.js'), 'utf8').replace(/^export /gm, '');
  const injected = html.slice(html.indexOf(RULES_BEGIN) + RULES_BEGIN.length, html.indexOf(RULES_END)).trim();
  if (injected !== source.trim()) {
    throw new Error('页面里的 rules 块和 lib/lowprice/rules.js 不一致 —— 重新跑 npm run build:links');
  }
  console.log('✓ rules 块与 lib/lowprice/rules.js 逐字节一致');

  if (rows.length === 0) {
    console.log('⚠ 页面里没有数据（未接入数据源），只完成源码一致性检查。');
    return;
  }

  // 2. 逐行：风险等级 / 低价幅度 / 价差
  let mismatch = 0;
  for (const row of rows) {
    if (page.getRiskLevel(row) !== lib.getRiskLevel(row)) mismatch += 1;
    if (page.getDiscountRate(row) !== lib.getDiscountRate(row)) mismatch += 1;
    if (page.getPriceGap(row) !== lib.getPriceGap(row)) mismatch += 1;
    if (page.getShopKey(row) !== lib.getShopKey(row)) mismatch += 1;
  }
  if (mismatch) throw new Error(`逐行口径有 ${mismatch} 处不一致`);
  console.log(`✓ 逐行口径一致（${rows.length} 行 × 4 项）`);

  // 3. 筛选组合：每种组合的五个指标都要对得上
  const dates = lib.collectDates(rows);
  const platforms = ['', ...lib.collectOptions(rows, 'platform')];
  const models = ['', ...lib.collectOptions(rows, 'model')];
  const versions = ['', ...lib.collectOptions(rows, 'version')];
  const lowModes = ['all', 'low', 'normal'] as const;
  const bands = ['all', 'mild', 'medium', 'high', 'severe'] as const;

  let combos = 0;
  const check = (filters: Parameters<typeof lib.applyFilters>[1]) => {
    const a = lib.summarize(lib.applyFilters(rows, filters));
    const b = page.summarize(page.applyFilters(rows, filters));
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      throw new Error(`筛选组合结果不一致：${JSON.stringify(filters)}\n  lib  ${JSON.stringify(a)}\n  page ${JSON.stringify(b)}`);
    }
    combos += 1;
  };

  for (const date of ['', ...dates]) {
    for (const platform of platforms) {
      check({ dateFrom: date, dateTo: date, platform });
    }
  }
  for (const model of models) {
    for (const version of versions) {
      for (const lowPrice of lowModes) check({ model, version, lowPrice });
    }
  }
  for (const band of bands) check({ band });
  for (const q of ['', '专营', 'http', '999']) check({ q });
  console.log(`✓ ${combos} 组筛选组合的五个指标一致`);

  // 4. 排序：每个排序键的结果序列必须一致
  for (const key of ['risk', 'price', 'gap', 'rate', 'sales', 'date'] as const) {
    for (const dir of ['asc', 'desc'] as const) {
      const a = lib.sortRows(rows, key, dir).map((r) => `${r.seq}`).join(',');
      const b = page.sortRows(rows, key, dir).map((r) => `${r.seq}`).join(',');
      if (a !== b) throw new Error(`排序 ${key}/${dir} 结果不一致`);
    }
  }
  console.log('✓ 6 个排序键 × 2 个方向结果一致');

  // 5. 店铺聚合
  const shopsA = JSON.stringify(lib.aggregateShops(rows));
  const shopsB = JSON.stringify(page.aggregateShops(rows));
  if (shopsA !== shopsB) throw new Error('店铺聚合结果不一致');
  console.log(`✓ 店铺聚合一致（${lib.aggregateShops(rows).length} 家店）`);

  // 6. 口径本身的内在一致性：低价数 = 各低价档之和，且和「仅低价」筛选对得上
  const all = lib.summarize(rows);
  const breakdown = lib.riskBreakdown(rows);
  const bandSum = breakdown.mild + breakdown.medium + breakdown.high + breakdown.severe;
  if (bandSum !== all.low) throw new Error(`低价档之和 ${bandSum} ≠ 低价链接数 ${all.low}`);
  const onlyLow = lib.summarize(lib.applyFilters(rows, { lowPrice: 'low' }));
  if (onlyLow.records !== all.low) throw new Error(`「仅低价」筛选 ${onlyLow.records} ≠ 低价链接数 ${all.low}`);
  if (breakdown.none + breakdown.unknown + all.low !== rows.length) {
    throw new Error('非低价 + 缺口径 + 低价 ≠ 总行数');
  }
  console.log(`✓ 口径自洽：${rows.length} = 低价 ${all.low} + 非低价 ${breakdown.none} + 缺口径 ${breakdown.unknown}`);

  console.log('');
  console.log('全部通过。');
}

try {
  main();
} catch (err) {
  console.error('✗ 对账失败：', err instanceof Error ? err.message : err);
  process.exit(1);
}
