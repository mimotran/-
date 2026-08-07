import { feishuGet } from './client';
import type { FeishuConfig } from './config';
import { toText } from './mapping';

/**
 * 读取飞书电子表格（Sheets）。
 *
 * 取值接口的 range 认的是 sheet_id（链接里 ?sheet= 后面那一段），不是工作表标题，
 * 所以这里先把标题解析成 id，让配置里两种写法都能用。
 *
 * 返回的是二维数组，第一行当表头转成 { 列名: 值 }，和多维表格的形状对齐，
 * 上层解析逻辑就能共用一套。
 */

interface SheetValuesResponse {
  valueRange?: {
    values?: unknown[][];
  };
}

interface SheetMetaResponse {
  sheets?: Array<{ sheet_id: string; title: string; grid_properties?: { row_count?: number } }>;
}

export interface SheetInfo {
  sheetId: string;
  title: string;
  rowCount: number;
}

export async function listSheets(cfg: FeishuConfig, spreadsheetToken: string): Promise<SheetInfo[]> {
  const data = await feishuGet<SheetMetaResponse>(
    `/sheets/v3/spreadsheets/${spreadsheetToken}/sheets/query`,
    {},
    cfg,
  );
  return (data.sheets ?? []).map((sheet) => ({
    sheetId: sheet.sheet_id,
    title: sheet.title,
    rowCount: sheet.grid_properties?.row_count ?? 5000,
  }));
}

/**
 * 读一个子表。`target` 可以是 sheet_id、工作表标题，或带 `!A1:Z100` 的完整区间。
 * 留空时读第一个子表。
 */
export async function readSheetRange(
  cfg: FeishuConfig,
  spreadsheetToken: string,
  target: string,
): Promise<Array<Record<string, unknown>>> {
  const fullRange = await resolveRange(cfg, spreadsheetToken, target);

  const data = await feishuGet<SheetValuesResponse>(
    `/sheets/v2/spreadsheets/${spreadsheetToken}/values/${encodeURIComponent(fullRange)}`,
    { valueRenderOption: 'ToString', dateTimeRenderOption: 'FormattedString' },
    cfg,
  );

  return toRecords(data.valueRange?.values ?? []);
}

async function resolveRange(
  cfg: FeishuConfig,
  spreadsheetToken: string,
  target: string,
): Promise<string> {
  // 已经写成完整区间就原样用
  if (target.includes('!')) return target;

  const sheets = await listSheets(cfg, spreadsheetToken);
  if (sheets.length === 0) throw new Error('该电子表格里没有任何子表');

  const picked = target
    ? (sheets.find((sheet) => sheet.sheetId === target) ??
      sheets.find((sheet) => sheet.title === target))
    : sheets[0];

  if (!picked) {
    const names = sheets.map((sheet) => `${sheet.title}(${sheet.sheetId})`).join('、');
    throw new Error(`电子表格里找不到子表「${target}」，可选：${names}`);
  }

  // 行数按实际网格取，多留一行余量；列固定读到 BZ，够放几十列指标
  const lastRow = Math.max(2, Math.min(picked.rowCount + 1, 20000));
  return `${picked.sheetId}!A1:BZ${lastRow}`;
}

/** 二维数组 → 记录数组；跳过表头之前的空行和整行空白 */
export function toRecords(values: unknown[][]): Array<Record<string, unknown>> {
  // 有些表前面几行是标题/说明，取第一行「非空单元格最多」的行当表头
  const headerIndex = values.findIndex((row) => row.filter((cell) => toText(cell, '') !== '').length >= 2);
  if (headerIndex < 0 || headerIndex >= values.length - 1) return [];

  const headers = values[headerIndex].map((cell, index) => toText(cell, `列${index + 1}`));

  return values.slice(headerIndex + 1).flatMap((row) => {
    if (row.every((cell) => toText(cell, '') === '')) return [];
    const record: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      record[header] = row[index];
    });
    return [record];
  });
}
