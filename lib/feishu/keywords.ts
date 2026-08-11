/**
 * 搜索词长表（Y26Plaud搜索关键词 工作簿）。
 *
 * 和主日报是两份完全独立的文档，所以单独一个 wiki token（FEISHU_WIKI_TOKEN_KEYWORDS）。
 * 工作簿里有六个子表，这里只读 `raw-天猫搜索词` 和 `raw-天猫付费词` 两张：
 *   · `关键词汇总` 是按月 × 固定词桶的透视，做不了 Top N 排行
 *   · `raw-京东关键词` 不在本看板口径内
 *
 * 两张 raw 表结构完全一样（统计日期 / 搜索词 / 访客数 / 加购人数 / …），
 * 天猫侧「搜索 + 付费」按 (日期, 词) 合并成一行 —— 同一个词既有自然曝光又被
 * 投放买过是常态，分开列会让同一个词在排行里出现两次，读的人得自己做加法。
 *
 * 按**子表标题**而不是 sheet_id 定位：id 是工作簿内部生成的，表被复制或重建
 * 就会变；标题是人维护的，改了也能一眼看出来。
 */

import { feishuGet } from './client';
import type { FeishuConfig } from './config';
import { listSheets } from './sheets';

/** 词性。品牌 / 品类 / 其他，和搜索 UV 堆叠图用的是同一套分档 */
export type TermKind = 'brand' | 'category' | 'other';

export interface SearchTermRow {
  /** YYYY-MM-DD */
  date: string;
  /** 展示用词形（拉丁词首字母大写后的） */
  term: string;
  kind: TermKind;
  /** 访客数 */
  uv: number;
  /** 支付买家数 */
  buyers: number;
  /** 支付金额（元） */
  gmv: number;
}

export interface SearchTermResult {
  rows: SearchTermRow[];
  warnings: string[];
}

/** 只认这两张，多一张少一张都会在 warnings 里说出来 */
const RAW_SHEETS = [/^raw-?天猫搜索词/, /^raw-?天猫付费词/];

/** 单次取值的行数上限。一次拉两万多行接口会超时，切块拉 */
const CHUNK = 4000;

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(cellText).join('');
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return String(obj.text ?? obj.link ?? '');
  }
  return String(value);
}

/** 「1,234」「¥1,234.5」「-」→ 数字。取不到就是 0，不抛 */
function toNumber(text: string): number {
  const cleaned = text.replace(/[,¥￥\s%]/g, '');
  if (!cleaned || cleaned === '-') return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** 「2026/01/01」「2026-1-1」→ 「2026-01-01」。认不出返回空串 */
function toDate(text: string): string {
  const m = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!m) return '';
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

/**
 * 展示用词形：拉丁字母段首字母大写。
 *
 * 源表全是小写（`plaud note pro录音笔`），直接摆上去整列都在喊小写，和页面
 * 其他地方的商品名对不上。中文不受影响，所以只动拉丁段。
 */
function displayTerm(raw: string): string {
  return raw.replace(/[a-z]+/g, (w) => w[0].toUpperCase() + w.slice(1));
}

/**
 * 品牌词的识别式。
 *
 * 除了正确拼写，还得收拼错的：搜索框里 `pluad` 一年有 1,244 个访客、`ploud`
 * 752 个，全都是冲着牌子来的人。把它们留在「其他」里，等于凭空削掉品牌词
 * 三千访客，还会让「其他」看起来莫名其妙地大。
 *
 * `notepin` / `note pin` 是产品线名，用户经常不带品牌直接搜（`Play Notepin S`
 * 是把 Plaud 听成了 Play），同样算品牌需求。
 *
 * 变体不是随便列的：都是从「其他」桶里按访客数倒序捞出来、逐个确认过词形的
 * （Pluad Note Pro、Ploud Ai、Plaid Note Pin S…），没有一个是真·别的东西。
 */
const BRAND_RE = /plaud|pluad|ploud|plued|plaod|plaoud|plud|paud|plaid|notepin|note ?pin/;

/**
 * 词性判定。
 *
 * 分档来自源工作簿 `关键词汇总` 的分桶方式：品牌桶是 Plaud / Plaud Note /
 * Plaud Note Pro / Plaude，品类桶是 录音笔 / 智能录音笔 / AI录音笔。
 * 推广到长尾就是两条包含规则 —— 带品牌名的一律算品牌词（`plaud录音笔` 是冲着
 * 牌子来的，不是冲品类），剩下带「录音」的算品类词，其余归其他。
 *
 * 判定顺序不能反：品牌优先，否则 `plaud录音笔` 会被划进品类。
 */
export function classifyTerm(raw: string): TermKind {
  const t = raw.toLowerCase();
  if (BRAND_RE.test(t)) return 'brand';
  if (t.includes('录音')) return 'category';
  return 'other';
}

async function readSheetRows(
  cfg: FeishuConfig,
  token: string,
  sheetId: string,
  rowCount: number,
): Promise<string[][]> {
  const out: string[][] = [];
  for (let start = 1; start <= rowCount; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, rowCount);
    const range = `${sheetId}!A${start}:J${end}`;
    const data = await feishuGet<{ valueRange?: { values?: unknown[][] } }>(
      `/sheets/v2/spreadsheets/${token}/values/${encodeURIComponent(range)}`,
      { valueRenderOption: 'FormattedValue', dateTimeRenderOption: 'FormattedString' },
      cfg,
    );
    for (const row of data.valueRange?.values ?? []) {
      out.push((row ?? []).map((c) => cellText(c).trim()));
    }
  }
  return out;
}

export async function readSearchTerms(
  cfg: FeishuConfig,
  spreadsheetToken: string,
): Promise<SearchTermResult> {
  const warnings: string[] = [];
  const sheets = await listSheets(cfg, spreadsheetToken);

  /** (日期 + 词) → 合并后的行。天猫搜索 + 付费同词同日累加 */
  const merged = new Map<string, SearchTermRow>();

  for (const pattern of RAW_SHEETS) {
    const sheet = sheets.find((s) => pattern.test(s.title));
    if (!sheet) {
      warnings.push(`搜索词工作簿里没有匹配 ${pattern.source} 的子表，该来源已跳过`);
      continue;
    }

    const rows = await readSheetRows(cfg, spreadsheetToken, sheet.sheetId, sheet.rowCount);
    let kept = 0;
    for (const row of rows) {
      const date = toDate(row[0] ?? '');
      const raw = (row[1] ?? '').trim();
      // 表头行、空行、以及日期认不出的行一律丢掉，不猜
      if (!date || !raw) continue;

      const term = displayTerm(raw.toLowerCase());
      const key = `${date} ${term}`;
      const prev = merged.get(key);
      const uv = toNumber(row[2] ?? '');
      const buyers = toNumber(row[5] ?? '');
      const gmv = toNumber(row[7] ?? '');
      if (prev) {
        prev.uv += uv; prev.buyers += buyers; prev.gmv += gmv;
      } else {
        merged.set(key, { date, term, kind: classifyTerm(raw), uv, buyers, gmv });
      }
      kept += 1;
    }

    if (kept === 0) warnings.push(`子表「${sheet.title}」没有解析出有效行`);
  }

  const rows = [...merged.values()].sort((a, b) => (a.date === b.date ? b.uv - a.uv : a.date < b.date ? -1 : 1));
  if (rows.length === 0) warnings.push('搜索词长表没有解析出任何数据，搜索词排行将为空');

  return { rows, warnings };
}
