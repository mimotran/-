/**
 * 二维网格读取：面向「合并表头 + 分段」这类人肉排版的表。
 *
 * 现有的 readSheetRange 把第一行当表头、转成 { 列名: 值 }，那套只对
 * 「一行表头、一行一条记录」的规整表管用。真实的天猫日报不是那样：
 *
 *   R2  店铺活动 │ 指标 │ 天猫-核心数据 …………………… │ 推广 ………… │ 流量 ……
 *   R3                                              │ 推广汇总 │ 站内汇总 │ 站外汇总
 *   R4  月汇总  │      │ GMV │ 主机销量 │ 退后GMV │ …… │ 站内消耗 │ 站内ROI │ ……
 *   R5  1月 ……                                     ← 月汇总
 *   R17 全年汇总
 *   R18 周汇总                                      ← 分段标记
 *   R72 日明细                                      ← 分段标记
 *   R73 日常 │ 1月1日 │ 23,521 │ ……                ← 真正要的数据
 *
 * 两个问题用名字索引都解决不了：
 *   1. 列名重复 —— 「推广消耗」在站外表里出现 6 次（汇总 + 5 个渠道），
 *      按名字取只会拿到第一个。所以合并分组行做前缀，得到
 *      「抖音CID/推广消耗」这种唯一路径。
 *   2. 一张表里混着月/周/日三种粒度 —— 按「日明细」这类标记切段，
 *      不切的话月汇总会被当成日数据，一年的量凭空翻好几倍。
 */

import { feishuGet } from './client';
import type { FeishuConfig } from './config';
import { toText } from './mapping';

interface SheetValuesResponse {
  valueRange?: { values?: unknown[][] };
}

export interface Grid {
  /** 原始单元格文本，rows[行][列]，行列都从 0 起 */
  rows: string[][];
  /** 合并后的列路径，索引 = 列号。形如 `站内分点位/Search_品牌词/SPD` */
  paths: string[];
  /** 表头那一行的行号（0 起） */
  headerRow: number;
}

/** 单元格 → 文本。飞书会把富文本返回成对象或数组，统一压成字符串 */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return value.map((item) => (item && typeof item === 'object' ? cellText(item) : String(item))).join('');
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return String(obj.text ?? obj.link ?? '');
  }
  return String(value);
}

/**
 * 合并单元格在接口里只有左上角有值，右边全是空。
 * 分组行必须向右填充，否则「抖音CID」底下第 2~8 列会认不出属于哪个渠道。
 */
function forwardFill(row: string[], width: number): string[] {
  const out = new Array<string>(width).fill('');
  let carry = '';
  for (let i = 0; i < width; i++) {
    const v = (row[i] ?? '').trim();
    if (v) carry = v;
    out[i] = carry;
  }
  return out;
}

export async function readGrid(
  cfg: FeishuConfig,
  spreadsheetToken: string,
  sheetId: string,
  opts: {
    /** 表头行号（1 起，和飞书界面上看到的一致） */
    headerRow: number;
    /** 参与拼前缀的分组行号（1 起）。按从粗到细给 */
    groupRows?: number[];
    /** 读到第几行、第几列 */
    lastRow?: number;
    lastCol?: string;
  },
): Promise<Grid> {
  const range = `${sheetId}!A1:${opts.lastCol ?? 'FZ'}${opts.lastRow ?? 2000}`;
  const data = await feishuGet<SheetValuesResponse>(
    `/sheets/v2/spreadsheets/${spreadsheetToken}/values/${encodeURIComponent(range)}`,
    // FormattedValue 才拿得到公式算完的结果；ToString 会把公式原文返回来
    { valueRenderOption: 'FormattedValue', dateTimeRenderOption: 'FormattedString' },
    cfg,
  );

  const raw = data.valueRange?.values ?? [];
  const width = raw.reduce((m, r) => Math.max(m, r.length), 0);
  const rows = raw.map((r) => {
    const line = new Array<string>(width).fill('');
    for (let i = 0; i < width; i++) line[i] = cellText(r[i]).trim();
    return line;
  });

  const hi = opts.headerRow - 1;
  const header = rows[hi] ?? [];
  const groups = (opts.groupRows ?? []).map((n) => forwardFill(rows[n - 1] ?? [], width));

  const paths = new Array<string>(width).fill('');
  for (let i = 0; i < width; i++) {
    const parts = [...groups.map((g) => g[i]), header[i] ?? ''].filter(Boolean);
    // 相邻重复的层级去掉：「搜索/搜索/访客数」读起来没有意义
    const dedup = parts.filter((p, k) => p !== parts[k - 1]);
    paths[i] = dedup.join('/');
  }

  return { rows, paths, headerRow: hi };
}

/**
 * 找出分段标记所在行。
 * 标记写在 A 列，形如「日明细」「日汇总」「每日数据」——同一本工作簿里三种写法都有，
 * 所以按关键词匹配而不是精确相等。
 */
export function findSection(grid: Grid, patterns: RegExp[]): number {
  for (let i = 0; i < grid.rows.length; i++) {
    const a = grid.rows[i][0] ?? '';
    if (patterns.some((p) => p.test(a))) return i;
  }
  return -1;
}

/**
 * 按列路径找列号。
 * `path` 用「包含」匹配，允许只写末段（`SPD`）或写全（`Search_品牌词/SPD`）。
 * 找不到返回 -1，由调用方决定是报错还是当 0 处理。
 */
export function col(grid: Grid, ...candidates: string[]): number {
  for (const c of candidates) {
    const exact = grid.paths.indexOf(c);
    if (exact >= 0) return exact;
  }
  for (const c of candidates) {
    const idx = grid.paths.findIndex((p) => p === c || p.endsWith(`/${c}`));
    if (idx >= 0) return idx;
  }
  return -1;
}

/** 某个分组下的列号，避免「推广消耗」在六个渠道里撞名 */
export function colIn(grid: Grid, group: string, leaf: string): number {
  return grid.paths.findIndex((p) => p.includes(group) && (p === leaf || p.endsWith(`/${leaf}`)));
}

/**
 * 数值解析。表里混着 `¥55,840`、`2.31%`、`1,384`、`-`、空。
 * 百分号要除以 100 —— 不除的话费率会变成 231%，所有比率指标都会离谱地大。
 */
export function num(text: string | undefined): number {
  if (!text) return 0;
  const t = text.trim();
  if (!t || t === '-' || t === '—' || t === '#DIV/0!' || t === '#N/A') return 0;
  const pct = t.endsWith('%');
  const cleaned = t.replace(/[¥$,\s%]/g, '');
  const v = Number(cleaned);
  if (!Number.isFinite(v)) return 0;
  return pct ? v / 100 : v;
}

/**
 * 日期解析。表里两种写法都有：`1月1日`（不带年）和 `2026/1/1`。
 * 不带年的按 defaultYear 补 —— 补错年份会让整份数据落到另一年，
 * 页面上表现为「全年累计是 0」，很难查，所以这里宁可返回 null 也不猜。
 */
export function parseSheetDate(text: string | undefined, defaultYear: number): string | null {
  if (!text) return null;
  const t = text.trim();

  const cn = t.match(/^(\d{1,2})月(\d{1,2})日$/);
  if (cn) return `${defaultYear}-${cn[1].padStart(2, '0')}-${cn[2].padStart(2, '0')}`;

  const ymd = t.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;

  return null;
}

/** 月份行解析：`1月` → 1。认不出返回 null */
export function parseMonth(text: string | undefined): number | null {
  const m = (text ?? '').trim().match(/^(\d{1,2})月$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 12 ? n : null;
}
