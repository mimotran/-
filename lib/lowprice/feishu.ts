/**
 * 从飞书电子表格拉「排查记录」。
 *
 * 这张表和天猫日报不在同一个文档里，所以单独配一份定位信息，
 * 凭证（FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_BASE_URL）仍然共用。
 *
 * 只读「排查记录」这一个子表 —— 同一个工作簿里的「看板」页是**人工汇总的展示层**，
 * 读它等于把二手数字当事实表用，源表一改两边就对不上。
 */

import { feishuGet } from '@/lib/feishu/client';
import { loadFeishuConfig, type FeishuConfig } from '@/lib/feishu/config';
import { listSheets, toRecords, type SheetInfo } from '@/lib/feishu/sheets';
import { parseLinkRows, type ParseResult } from './parse';
import type { LinkSnapshot } from './types';

/**
 * 默认数据源 = 需求里给的那张表。
 * 只是文档定位，不是凭据（没有 App Secret 拿它什么也读不到），
 * 所以写进代码里，好让 CI 上只配一套飞书凭证就能跑。换表用环境变量覆盖。
 */
export const DEFAULT_SPREADSHEET_TOKEN = 'YEDVs46o2hzZ8htBnakcbzNpnrp';
/** 需求链接里的 ?sheet=，按标题找不到时的兜底 */
export const DEFAULT_SHEET_ID = '1WDztC';
/** 按标题定位子表：标题比 sheet_id 稳 —— 表被复制一次，id 就全变了 */
export const DEFAULT_SHEET_TITLE = '排查记录';

const DOC_HOST = 'https://nicebuild.feishu.cn/sheets';

export interface LowPriceSource {
  spreadsheetToken: string;
  /** 工作表标题或 sheet_id；留空走「排查记录」→ 1WDztC → 第一个子表 */
  sheet: string;
}

export function loadLowPriceSource(): LowPriceSource {
  return {
    spreadsheetToken:
      (process.env.FEISHU_LOWPRICE_SPREADSHEET_TOKEN ?? '').trim() || DEFAULT_SPREADSHEET_TOKEN,
    sheet: (process.env.FEISHU_LOWPRICE_SHEET ?? '').trim(),
  };
}

export function isLowPriceConfigured(cfg: FeishuConfig = loadFeishuConfig()): boolean {
  return Boolean(cfg.appId && cfg.appSecret && loadLowPriceSource().spreadsheetToken);
}

export function docUrl(token: string, sheetId: string): string {
  return `${DOC_HOST}/${token}${sheetId ? `?sheet=${sheetId}` : ''}`;
}

/** 在子表清单里挑出「排查记录」。顺序：配置值 → 标题精确 → 标题包含「排查」→ 需求里的 id */
export function pickSheet(sheets: SheetInfo[], target: string): SheetInfo | null {
  if (!sheets.length) return null;
  const byId = (id: string) => sheets.find((s) => s.sheetId === id);
  const byTitle = (title: string) => sheets.find((s) => s.title.trim() === title);

  if (target) return byTitle(target) ?? byId(target) ?? null;
  return (
    byTitle(DEFAULT_SHEET_TITLE) ??
    sheets.find((s) => s.title.includes('排查')) ??
    byId(DEFAULT_SHEET_ID) ??
    null
  );
}

interface SheetValuesResponse {
  valueRange?: { values?: unknown[][] };
}

/**
 * 读一个子表的全部单元格。
 *
 * 这里**不传** valueRenderOption：默认返回带类型的值，超链接是
 * `{ type:'url', text, link }`。传 ToString 会把对象压成显示文案，
 * 「商品链接」列就只剩下「链接」两个字，跳转按钮全废。
 */
async function readValues(
  cfg: FeishuConfig,
  token: string,
  sheet: SheetInfo,
): Promise<unknown[][]> {
  const lastRow = Math.max(2, Math.min(sheet.rowCount + 1, 20000));
  const range = `${sheet.sheetId}!A1:BZ${lastRow}`;
  const data = await feishuGet<SheetValuesResponse>(
    `/sheets/v2/spreadsheets/${token}/values/${encodeURIComponent(range)}`,
    {},
    cfg,
  );
  return data.valueRange?.values ?? [];
}

export interface SyncResult extends LinkSnapshot {
  parse: ParseResult;
  sheets: SheetInfo[];
}

export async function syncLinks(cfg: FeishuConfig = loadFeishuConfig()): Promise<SyncResult> {
  const source = loadLowPriceSource();
  const sheets = await listSheets(cfg, source.spreadsheetToken);
  const sheet = pickSheet(sheets, source.sheet);

  if (!sheet) {
    const names = sheets.map((s) => `${s.title}(${s.sheetId})`).join('、') || '(空)';
    throw new Error(
      `工作簿里找不到「排查记录」子表${source.sheet ? `（配置值：${source.sheet}）` : ''}。可选：${names}`,
    );
  }

  const values = await readValues(cfg, source.spreadsheetToken, sheet);
  const parse = parseLinkRows(toRecords(values));

  const warnings = [...parse.warnings];
  if (parse.rows.length === 0) {
    warnings.push(`子表「${sheet.title}」里没有解析出任何记录，请核对表头与数据区。`);
  }

  return {
    rows: parse.rows,
    source: parse.rows.length ? 'feishu' : 'none',
    syncedAt: new Date().toISOString(),
    docUrl: docUrl(source.spreadsheetToken, sheet.sheetId),
    sheetTitle: sheet.title,
    warnings,
    parse,
    sheets,
  };
}
