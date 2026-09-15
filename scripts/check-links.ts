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

  // 6. 趋势 / 批次：页面上的图和 KPI 环比都走这几个函数
  const trendA = lib.trendSeries(rows);
  const trendB = page.trendSeries(rows);
  if (JSON.stringify(trendA) !== JSON.stringify(trendB)) throw new Error('趋势序列不一致');
  // 每期的指标必须等于「按那一天筛出来再 summarize」，否则趋势图和 KPI 会各说各话
  for (const point of trendA) {
    const direct = lib.summarize(lib.applyFilters(rows, { dateFrom: point.date, dateTo: point.date }));
    for (const key of ['records', 'low', 'lowRate', 'shops', 'severe'] as const) {
      if (Math.abs(point[key] - direct[key]) > 1e-9) {
        throw new Error(`趋势里 ${point.date} 的 ${key} 与按日期筛选的结果不一致`);
      }
    }
  }
  const trendRecords = trendA.reduce((a, p) => a + p.records, 0);
  if (trendRecords !== rows.length) throw new Error(`各期记录数之和 ${trendRecords} ≠ 总行数 ${rows.length}`);
  console.log(`✓ 趋势序列一致（${trendA.length} 期，各期之和 = 总行数）`);

  const dedupA = lib.latestPerLink(rows);
  if (JSON.stringify(dedupA.map((r) => r.seq).sort()) !== JSON.stringify(page.latestPerLink(rows).map((r) => r.seq).sort())) {
    throw new Error('按链接去重的结果不一致');
  }
  if (dedupA.length !== lib.summarize(rows).links) {
    throw new Error(`去重后行数 ${dedupA.length} ≠ 去重链接数 ${lib.summarize(rows).links}`);
  }
  console.log(`✓ 按链接去重一致（${rows.length} → ${dedupA.length} 条）`);

  for (const [name, a, b] of [
    ['产品分布', lib.distribution(rows), page.distribution(rows)],
    ['发货地分布', lib.breakdownBy(rows, 'region'), page.breakdownBy(rows, 'region')],
    ['店铺类型分布', lib.breakdownBy(rows, 'shopType'), page.breakdownBy(rows, 'shopType')],
  ] as const) {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${name}不一致`);
  }
  const distSum = lib.distribution(rows).reduce((a, d) => a + d.records, 0);
  if (distSum !== rows.length) throw new Error(`分布各组之和 ${distSum} ≠ 总行数 ${rows.length}`);
  console.log('✓ 分布聚合一致，且各组之和 = 总行数');

  for (const i in dates) {
    const d = dates[i];
    const a = lib.previousRange(dates, d, d);
    const b = page.previousRange(dates, d, d);
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`previousRange(${d}) 不一致`);
    const expect = Number(i) > 0 ? dates[Number(i) - 1] : null;
    if ((a ? a.to : null) !== expect) throw new Error(`${d} 的上一期应当是 ${expect}，实际 ${a ? a.to : null}`);
  }
  console.log(`✓ 环比窗口一致（${dates.length} 期，逐期核对上一期）`);

  // 低价均差只对低价链接取平均 —— 把非低价算进来会被高于指导价的行拉成负数
  const lowRows = lib.applyFilters(rows, { lowPrice: 'low' });
  if (lowRows.length) {
    const manual = lowRows.reduce((a, r) => a + (lib.getPriceGap(r) ?? 0), 0) / lowRows.length;
    if (Math.abs(manual - lib.summarize(rows).avgLowGap) > 1e-6) throw new Error('低价均差口径不一致');
    console.log(`✓ 低价均差 ¥${manual.toFixed(2)}（只对 ${lowRows.length} 条低价链接取平均）`);
  }

  // 7. 口径本身的内在一致性：低价数 = 各低价档之和，且和「仅低价」筛选对得上
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
