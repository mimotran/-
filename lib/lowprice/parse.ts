/**
 * 「排查记录」→ LinkRecord[]。
 *
 * 一条铁律：**按表头名找列，不按 A/B/C 列号**。源表以后插一列、挪一列，
 * 按列号取值会整体错位，而且错得毫无征兆 —— 页面照样渲染，只是价格列变成了月销。
 *
 * 认不出的行跳过并记一条告警，不猜。宁可少一行，也不要猜错一行。
 */

import { normalizeHeader, pick, toDate, toNumber, toText } from '@/lib/feishu/mapping';
import type { LinkRecord } from './types';
import { getDiscountRate, getPriceGap } from './rules.js';

/**
 * 列别名。每项的第一个是需求里给出的表头原名，后面是同义写法兜底。
 * 表头改了只要在这里加一个别名，其它代码不用动。
 *
 * normalizeHeader 会去掉空格、把全角括号转半角、并削掉结尾的 `(元)` `(%)` 这类单位，
 * 所以「价差(元)」「价差（元）」「价差」写一个就够。
 */
export const LINK_ALIASES = {
  seq: ['序号', '编号', 'No', 'no', '#'],
  date: ['排查日期', '巡检日期', '监测日期', '检查日期', '日期', '时间'],
  platform: ['平台', '渠道', '电商平台', '所属平台'],
  shop: ['卖家昵称', '店铺名称', '店铺名', '卖家名称', '店铺', '卖家'],
  sellerId: ['卖家ID/UID', '卖家ID', '卖家UID', '卖家id', 'UID', '店铺ID', '商家ID'],
  shopType: ['店铺类型', '店铺性质', '店铺属性', '渠道类型'],
  url: ['商品链接URL', '商品链接', '商品URL', '宝贝链接', '链接', '商品地址'],
  shopUrl: ['店铺链接', '店铺URL', '店铺地址', '旺旺链接'],
  model: ['产品型号', '型号', '商品型号', '产品', '产品名称'],
  version: ['版本', '版本类型', '国内/海外', '区域版本'],
  // 源表这一列实际叫「违规售价」，需求文档里写的是「发现价格」，两个都认
  price: ['违规售价', '发现价格', '违规价格', '发现价', '监测价格', '实际售价', '到手价', '售价', '成交价'],
  listPrice: ['官方指导价', '指导价', '官方价', '官方售价', '建议零售价', '控价'],
  gap: ['价差(元)', '价差', '差价', '价格差'],
  rate: ['低价幅度', '低价幅度(%)', '降价幅度', '低价比例', '折扣幅度'],
  monthlySales: ['月销', '月销量', '30天销量', '近30天销量', '销量'],
  region: ['发货地', '发货地址', '所在地', '发货区域', '地区'],
  note: ['备注', '说明', '备注说明', '情况说明'],
} as const satisfies Record<string, readonly string[]>;

export type LinkField = keyof typeof LINK_ALIASES;

/** 整行都空、或者是「合计 / 汇总 / 小计」这类人肉排版行，直接跳过 */
const SUMMARY_ROW = /^(合计|总计|汇总|小计|总数|备注说明|说明)$/;

export interface ParseResult {
  rows: LinkRecord[];
  warnings: string[];
  /** 表头对齐报告：字段 → 命中的真实列名（没命中为 null），`npm run sync:links` 会打出来 */
  headerMap: Record<string, string | null>;
  /** 跳过的行数 */
  skipped: number;
}

/** 空单元格 → null，而不是 0。价格为 0 和价格没填是两回事 */
function numberOrNull(value: unknown): number | null {
  if (toText(value) === '') return null;
  const n = toNumber(value, Number.NaN);
  return Number.isFinite(n) ? n : null;
}

/**
 * 宽松数字：从「月销500+」「到手价 1,310」「1.2万」这类**带文案的**单元格里抠出数值。
 *
 * 月销在淘宝上就是「500+」这种写法，严格解析会全部变成空。抠第一段数字有代价 ——
 * 「满2件减50」会被读成 2 —— 所以只在严格解析失败时才走这条路，并统计次数报一条告警，
 * 让人能回源表看一眼到底是哪些格子。
 */
function looseNumber(value: unknown): number | null {
  const text = toText(value);
  if (!text) return null;
  const match = text.replace(/[,，\s¥￥$]/g, '').match(/(-?\d+(?:\.\d+)?)\s*(万|k|K)?/);
  if (!match) return null;
  let n = Number(match[1]);
  if (!Number.isFinite(n)) return null;
  if (match[2] === '万') n *= 10000;
  else if (match[2]) n *= 1000;
  return n;
}

/**
 * 超链接单元格。飞书电子表格的 url 类型返回 `{ type:'url', text, link }`，
 * 只取 text 会把真实地址丢掉（显示文案常常是「链接」两个字）。
 */
function toUrl(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = toUrl(item);
      if (hit) return hit;
    }
    return '';
  }
  if (typeof value === 'object') {
    const obj = value as { link?: unknown; text?: unknown };
    const link = toText(obj.link);
    if (link) return link;
    return toUrl(obj.text);
  }
  const text = String(value).trim();
  if (!text) return '';
  // 纯文本单元格里也可能混着说明文字，抠出第一个 http(s) 地址
  const match = text.match(/https?:\/\/[^\s，,、]+/);
  if (match) return match[0];
  return /^[\w.-]+\.(com|cn|net)\b/i.test(text) ? `https://${text}` : '';
}

/**
 * 源表里的「低价幅度」可能写成 0.0636、6.36% 或 6.36 三种。
 * toNumber 认得百分号，剩下 6.36 这种裸数按百分点处理 —— 一条链接不可能便宜 636%。
 *
 * 但**卖得比指导价贵一倍以上**时幅度本来就会超过 -100%（售价 4123 / 指导价 1299 → -217%），
 * 源表存的就是 -2.17 这个小数。所以只有在现算幅度落在 ±100% 以内时，才把 >1 的裸数
 * 当成百分点 —— 少了这个前提，这类行会被误判成「源表和现算对不上」，把哨兵变成噪音。
 */
function rateOrNull(value: unknown, computed: number | null): number | null {
  const n = numberOrNull(value);
  if (n === null) return null;
  if (Math.abs(n) > 1 && (computed === null || Math.abs(computed) <= 1)) return n / 100;
  return n;
}

export function parseLinkRows(records: Array<Record<string, unknown>>): ParseResult {
  const warnings: string[] = [];
  const rows: LinkRecord[] = [];
  const headerMap = buildHeaderMap(records[0] ?? {});
  const defaultYear = new Date().getUTCFullYear();

  let skipped = 0;
  let noDate = 0;
  let noListPrice = 0;
  let gapMismatch = 0;
  let rateMismatch = 0;
  let loosePrice = 0;

  /**
   * 先严格解析，失败了再宽松抠一次数字。
   *
   * 只有**价格**走到宽松路径才记一笔告警 —— 月销在淘宝上本来就写成「23人付款」，
   * 每次都报一条「112 个单元格带文案」等于把哨兵调成噪音。
   */
  const numField = (value: unknown, isPrice = false): number | null => {
    const strict = numberOrNull(value);
    if (strict !== null) return strict;
    if (toText(value) === '') return null;
    const relaxed = looseNumber(value);
    if (relaxed !== null && isPrice) loosePrice += 1;
    return relaxed;
  };

  records.forEach((record, index) => {
    const get = (field: LinkField) => pick(record, LINK_ALIASES[field]);

    const seqText = toText(get('seq'));
    const platform = toText(get('platform'));
    const shop = toText(get('shop'));
    const url = toUrl(get('url'));
    const rawDate = get('date');

    // 全空行 / 汇总行
    if (SUMMARY_ROW.test(seqText) || SUMMARY_ROW.test(platform)) {
      skipped += 1;
      return;
    }
    if (!platform && !shop && !url && toText(rawDate) === '') {
      skipped += 1;
      return;
    }

    const date = toDate(rawDate, defaultYear);
    if (!date) {
      // 没有排查日期就进不了任何日期筛选，留着只会让「在架链接」比表格多出几条
      skipped += 1;
      noDate += 1;
      return;
    }

    const row: LinkRecord = {
      seq: Number.isFinite(Number(seqText)) && seqText !== '' ? Number(seqText) : index + 1,
      date,
      platform,
      shop,
      sellerId: toText(get('sellerId')),
      shopType: toText(get('shopType')),
      model: toText(get('model')),
      version: toText(get('version')),
      price: numField(get('price'), true),
      listPrice: numField(get('listPrice'), true),
      monthlySales: numField(get('monthlySales')),
      region: toText(get('region')),
      note: toText(get('note')),
      url,
      shopUrl: toUrl(get('shopUrl')),
    };

    if (row.listPrice === null || row.price === null) noListPrice += 1;

    // --- 校验和：源表自己算过的价差 / 低价幅度，和我们的口径对一遍 -------------
    // 「读到了 N 行」和「读对了 N 行」是两件事。对不上的往往是列错位或者方向反了
    // （把 发现价格−官方指导价 当成价差），这里只告警不改数：以原始价格为准。
    const srcGap = numberOrNull(get('gap'));
    const gap = getPriceGap(row);
    if (srcGap !== null && gap !== null && Math.abs(srcGap - gap) > 1) gapMismatch += 1;

    const rate = getDiscountRate(row);
    const srcRate = rateOrNull(get('rate'), rate);
    if (srcRate !== null && rate !== null && Math.abs(srcRate - rate) > 0.005) rateMismatch += 1;

    rows.push(row);
  });

  const missing = Object.entries(headerMap)
    .filter(([, column]) => column === null)
    .map(([field]) => field);
  if (missing.length) {
    warnings.push(
      `「排查记录」里有 ${missing.length} 个字段没找到对应列：${missing.join('、')}。` +
        '请核对表头，或在 lib/lowprice/parse.ts 的 LINK_ALIASES 里补一个别名。',
    );
  }
  if (noDate) warnings.push(`${noDate} 行没有可识别的排查日期，已跳过。`);
  if (loosePrice) {
    warnings.push(
      `${loosePrice} 个价格单元格带着文案（如「到手价 1,310」），已抠出其中的数字。` +
        '数值异常时先回源表看这些格子。',
    );
  }
  if (noListPrice) {
    warnings.push(
      `${noListPrice} 行缺发现价格或官方指导价，算不出低价幅度，` +
        '在页面上标为「缺口径」，不计入低价统计。',
    );
  }
  if (gapMismatch) {
    warnings.push(
      `${gapMismatch} 行的源表「价差」与「官方指导价 − 发现价格」对不上（差 > 1 元）。` +
        '页面以原始价格现算为准，请人工复核源表。',
    );
  }
  if (rateMismatch) {
    warnings.push(
      `${rateMismatch} 行的源表「低价幅度」与现算值对不上（差 > 0.5 个百分点）。` +
        '页面以原始价格现算为准，请人工复核源表。',
    );
  }

  return { rows, warnings, headerMap, skipped };
}

/** 拿第一行记录的键（= 真实表头）跑一遍别名表，输出字段 → 列名的对齐报告 */
export function buildHeaderMap(sample: Record<string, unknown>): Record<string, string | null> {
  const index = new Map<string, string>();
  for (const header of Object.keys(sample)) {
    const key = normalizeHeader(header);
    if (!index.has(key)) index.set(key, header);
  }

  const out: Record<string, string | null> = {};
  for (const [field, aliases] of Object.entries(LINK_ALIASES)) {
    out[field] = null;
    for (const alias of aliases) {
      const hit = index.get(normalizeHeader(alias));
      if (hit !== undefined) {
        out[field] = hit;
        break;
      }
    }
  }
  return out;
}
