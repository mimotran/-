import { feishuGet } from './client';
import type { FeishuConfig } from './config';

/**
 * 读取飞书多维表格（Bitable）。
 */

interface BitableRecordsPage {
  items?: Array<{ record_id: string; fields: Record<string, unknown> }>;
  page_token?: string;
  has_more?: boolean;
}

interface BitableTableList {
  items?: Array<{ table_id: string; name: string }>;
}

/** 列出多维表格里的所有数据表，用于按名称找 table_id */
export async function listBitableTables(
  cfg: FeishuConfig,
  appToken: string,
): Promise<Array<{ table_id: string; name: string }>> {
  const data = await feishuGet<BitableTableList>(
    `/bitable/v1/apps/${appToken}/tables`,
    { page_size: 100 },
    cfg,
  );
  return data.items ?? [];
}

/**
 * 拉一张表的全部记录。每页最多 500 条，用 page_token 翻到底。
 * `table` 可以是 table_id，也可以是数据表名称。
 */
export async function readBitableTable(
  cfg: FeishuConfig,
  appToken: string,
  table: string,
): Promise<Array<Record<string, unknown>>> {
  const tableId = table.startsWith('tbl')
    ? table
    : (await listBitableTables(cfg, appToken)).find((item) => item.name === table)?.table_id;

  if (!tableId) {
    throw new Error(`多维表格里找不到数据表「${table}」`);
  }

  const rows: Array<Record<string, unknown>> = [];
  let pageToken: string | undefined;
  // 兜底上限，防止表被写爆时无限翻页
  const maxPages = 40;

  for (let page = 0; page < maxPages; page++) {
    const data = await feishuGet<BitableRecordsPage>(
      `/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
      { page_size: 500, page_token: pageToken },
      cfg,
    );

    for (const item of data.items ?? []) {
      rows.push(item.fields);
    }

    if (!data.has_more || !data.page_token) break;
    pageToken = data.page_token;
  }

  return rows;
}
