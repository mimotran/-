import type { DashboardSnapshot } from '@/lib/types';
import { readBitableTable } from './bitable';
import { isFeishuConfigured, loadFeishuConfig, type FeishuConfig, type FeishuDocType } from './config';
import { parseCampaigns, parseChannels, parseDaily, parseProducts } from './normalize';
import { readSheetRange } from './sheets';
import { resolveWikiNode } from './wiki';

/**
 * 从飞书文档拉一份完整快照。
 *
 * 只有日报表是必需的；渠道 / 商品 / 活动三张表没配或者读失败，
 * 对应板块降级为空态，不影响销售概览。
 */

type TableKey = 'daily' | 'channels' | 'products' | 'campaigns';

const TABLE_LABELS: Record<TableKey, string> = {
  daily: '日报表',
  channels: '流量渠道表',
  products: '商品明细表',
  campaigns: '活动表',
};

interface ResolvedSource {
  docType: FeishuDocType;
  /** 电子表格的 spreadsheet_token 或多维表格的 app_token */
  token: string;
  targets: Record<TableKey, string>;
}

/**
 * 定位真正要读的文档。
 * 配了 wiki token 就先换算成 obj_token —— 知识库链接里的 token 不能直接用。
 */
export async function resolveSource(cfg: FeishuConfig): Promise<ResolvedSource> {
  if (cfg.wikiToken) {
    const node = await resolveWikiNode(cfg, cfg.wikiToken);
    if (node.objType !== 'sheet' && node.objType !== 'bitable') {
      throw new Error(
        `wiki 节点「${node.title || cfg.wikiToken}」是 ${node.objType} 类型，不是电子表格或多维表格，无法作为数据源`,
      );
    }
    const docType: FeishuDocType = node.objType === 'sheet' ? 'sheets' : 'bitable';
    return {
      docType,
      token: node.objToken,
      targets: docType === 'sheets' ? cfg.sheets.ranges : cfg.bitable.tables,
    };
  }

  return cfg.docType === 'bitable'
    ? { docType: 'bitable', token: cfg.bitable.appToken, targets: cfg.bitable.tables }
    : { docType: 'sheets', token: cfg.sheets.spreadsheetToken, targets: cfg.sheets.ranges };
}

export async function syncFromFeishu(
  cfg: FeishuConfig = loadFeishuConfig(),
): Promise<DashboardSnapshot> {
  if (!isFeishuConfigured(cfg)) {
    throw new Error('飞书数据源未配置完整，请检查 FEISHU_APP_ID / FEISHU_APP_SECRET 及文档 token');
  }

  const warnings: string[] = [];
  const source = await resolveSource(cfg);

  const read = (key: TableKey) =>
    source.docType === 'bitable'
      ? readBitableTable(cfg, source.token, source.targets[key])
      : readSheetRange(cfg, source.token, source.targets[key]);

  /** 可选表：没配或读失败只记 warning，不打断同步 */
  async function readOptional(key: Exclude<TableKey, 'daily'>): Promise<Array<Record<string, unknown>>> {
    if (!source.targets[key]) {
      warnings.push(`未配置${TABLE_LABELS[key]}，对应板块暂无数据`);
      return [];
    }
    try {
      return await read(key);
    } catch (err) {
      warnings.push(`${TABLE_LABELS[key]}读取失败：${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  const [rawDaily, rawChannels, rawProducts, rawCampaigns] = await Promise.all([
    read('daily'),
    readOptional('channels'),
    readOptional('products'),
    readOptional('campaigns'),
  ]);

  const daily = parseDaily(rawDaily);
  const channels = parseChannels(rawChannels);
  const products = parseProducts(rawProducts);
  const campaigns = parseCampaigns(rawCampaigns);

  if (daily.rows.length === 0) {
    throw new Error(
      '日报表没有解析出任何有效数据。请检查表头是否包含「日期」「支付金额」等列，' +
        '列名不一致时在 lib/feishu/mapping.ts 里补一个别名即可',
    );
  }

  warnings.push(...daily.warnings, ...channels.warnings, ...products.warnings, ...campaigns.warnings);

  return {
    source: source.docType === 'bitable' ? 'feishu-bitable' : 'feishu-sheets',
    syncedAt: new Date().toISOString(),
    coverage: {
      from: daily.rows[0].date,
      to: daily.rows[daily.rows.length - 1].date,
    },
    daily: daily.rows,
    channels: channels.rows,
    products: products.rows,
    campaigns: campaigns.rows,
    // warning 太多时只留前 20 条，页面上放不下也没人看
    warnings: warnings.slice(0, 20),
  };
}
