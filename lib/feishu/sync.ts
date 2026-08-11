import type { DashboardSnapshot, SearchTermRow } from '@/lib/types';
import { readBitableTable } from './bitable';
import {
  TABLE_LABELS,
  isFeishuConfigured,
  loadFeishuConfig,
  type FeishuConfig,
  type FeishuDocType,
  type TableKey,
  type TableTargets,
} from './config';
import { parseAds, parseDaily, parseProducts, parseTargets } from './normalize';
import { readSheetRange } from './sheets';
import { resolveWikiNode } from './wiki';
import { readSearchTerms } from './keywords';
import { readWorkbook } from './workbook';

/**
 * 从飞书文档拉一份完整快照。
 *
 * 只有日报表是必需的；投放 / 商品 / 关键词 / 目标没配或读失败，
 * 对应板块降级为空态，不影响其它板块。
 */

export interface ResolvedSource {
  docType: FeishuDocType;
  /** 电子表格的 spreadsheet_token 或多维表格的 app_token */
  token: string;
  targets: TableTargets;
}

/**
 * 定位真正要读的文档。
 * 配了 wiki token 就先换算成 obj_token —— 知识库链接里的 token 不能直接用。
 */
export async function resolveSource(cfg: FeishuConfig, wikiToken?: string): Promise<ResolvedSource> {
  const token = wikiToken || cfg.wikiToken;

  if (token) {
    const node = await resolveWikiNode(cfg, token);
    if (node.objType !== 'sheet' && node.objType !== 'bitable') {
      throw new Error(
        `wiki 节点「${node.title || token}」是 ${node.objType} 类型，不是电子表格或多维表格，无法作为数据源`,
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

export function readTable(
  cfg: FeishuConfig,
  source: ResolvedSource,
  target: string,
): Promise<Array<Record<string, unknown>>> {
  return source.docType === 'bitable'
    ? readBitableTable(cfg, source.token, target)
    : readSheetRange(cfg, source.token, target);
}

export async function syncFromFeishu(
  cfg: FeishuConfig = loadFeishuConfig(),
): Promise<DashboardSnapshot> {
  if (!isFeishuConfigured(cfg)) {
    throw new Error('飞书数据源未配置完整，请检查 FEISHU_APP_ID / FEISHU_APP_SECRET 及文档 token');
  }

  const warnings: string[] = [];
  const main = await resolveSource(cfg);

  // 投放和关键词可能在另外的文档里，各自解析一次；没单独配就沿用主文档
  const [adsSource, keywordsSource] = await Promise.all([
    cfg.adsWikiToken ? resolveSource(cfg, cfg.adsWikiToken).catch(() => main) : Promise.resolve(main),
    cfg.keywordsWikiToken
      ? resolveSource(cfg, cfg.keywordsWikiToken).catch(() => main)
      : Promise.resolve(main),
  ]);

  const sourceFor = (key: TableKey): ResolvedSource =>
    key === 'adsInsite' || key === 'adsOffsite' ? adsSource : main;

  /** 可选表：没配或读失败只记 warning，不打断同步 */
  async function readOptional(key: TableKey): Promise<Array<Record<string, unknown>>> {
    const source = sourceFor(key);
    const target = source.targets[key];
    if (!target) {
      warnings.push(`未配置${TABLE_LABELS[key]}，对应板块暂无数据`);
      return [];
    }
    try {
      return await readTable(cfg, source, target);
    } catch (err) {
      warnings.push(`${TABLE_LABELS[key]}读取失败：${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  /**
   * 搜索词长表在另一份工作簿里，没配 FEISHU_WIKI_TOKEN_KEYWORDS 就整块跳过。
   * 它是**可选**数据源：读失败只记 warning，不能因为一张长表把整个看板拖垮。
   */
  async function readKeywords(): Promise<{ rows: SearchTermRow[]; warnings: string[] }> {
    if (!cfg.keywordsWikiToken) {
      return { rows: [], warnings: ['未配置搜索词工作簿（FEISHU_WIKI_TOKEN_KEYWORDS），搜索词排行为空'] };
    }
    if (keywordsSource.docType !== 'sheets') {
      return { rows: [], warnings: ['搜索词工作簿不是电子表格，暂不支持'] };
    }
    try {
      return await readSearchTerms(cfg, keywordsSource.token);
    } catch (err) {
      return { rows: [], warnings: [`搜索词长表读取失败：${err instanceof Error ? err.message : String(err)}`] };
    }
  }

  /**
   * 电子表格走 workbook 解析。
   *
   * 真实的天猫日报是人肉排版的多页签工作簿（合并表头、月/周/日混在一张表里、
   * 同名列在六个分组下重复），通用的「按列名别名找列」表达不了这种结构。
   * 多维表格那条路仍然走 normalize —— 那边一行就是一条记录，通用解析是对的。
   */
  if (main.docType === 'sheets') {
    const year = Number(process.env.FEISHU_DATA_YEAR) || new Date().getUTCFullYear();
    const [snapshot, keywords] = await Promise.all([
      readWorkbook(cfg, main.token, year),
      readKeywords(),
    ]);
    return {
      ...snapshot,
      searchTerms: keywords.rows,
      warnings: [...warnings, ...snapshot.warnings, ...keywords.warnings].slice(0, 20),
    };
  }

  const [rawDaily, rawInsite, rawOffsite, rawProducts, rawTargets] = await Promise.all([
    readTable(cfg, main, main.targets.daily),
    readOptional('adsInsite'),
    readOptional('adsOffsite'),
    readOptional('products'),
    readOptional('targets'),
  ]);

  // 日报表里「7月1日」这种写法不带年份，用当前年份补齐
  const defaultYear = Number(process.env.FEISHU_DATA_YEAR) || new Date().getUTCFullYear();

  const daily = parseDaily(rawDaily, defaultYear);
  const insite = parseAds(rawInsite, 'insite', defaultYear);
  const offsite = parseAds(rawOffsite, 'offsite', defaultYear);
  const products = parseProducts(rawProducts, defaultYear);
  const targets = parseTargets(rawTargets, defaultYear);

  if (daily.rows.length === 0) {
    throw new Error('日报表没有解析出任何有效数据。先跑 `npm run headers` 看真实表头');
  }

  warnings.push(
    ...daily.warnings, ...insite.warnings, ...offsite.warnings,
    ...products.warnings, ...targets.warnings,
  );

  return {
    source: 'feishu-bitable',
    syncedAt: new Date().toISOString(),
    coverage: { from: daily.rows[0].date, to: daily.rows[daily.rows.length - 1].date },
    daily: daily.rows,
    ads: [...insite.rows, ...offsite.rows],
    products: products.rows,
    trafficChannels: [],
    targets: targets.rows,
    // 多维表格这条路暂时不接搜索词长表
    searchTerms: [],
    monthlyActuals: {},
    excludedProductGmv: {},
    // warning 太多时只留前 20 条，页面上放不下也没人看
    warnings: warnings.slice(0, 20),
  };
}
