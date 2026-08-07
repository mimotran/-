/**
 * 飞书数据源配置：全部走环境变量，方便本地 / Vercel / GitHub Actions 共用一套代码。
 * 见 .env.example。
 */

export type FeishuDocType = 'bitable' | 'sheets';

/** 看板需要的六张表。只有日报是必需的，其余缺了对应板块降级为空态 */
export type TableKey = 'daily' | 'adsInsite' | 'adsOffsite' | 'products' | 'keywords' | 'targets';

export const TABLE_KEYS: TableKey[] = [
  'daily',
  'adsInsite',
  'adsOffsite',
  'products',
  'keywords',
  'targets',
];

export const TABLE_LABELS: Record<TableKey, string> = {
  daily: '日报表',
  adsInsite: '站内投放表',
  adsOffsite: '站外投放表',
  products: '商品明细表',
  keywords: '搜索关键词表',
  targets: '目标表',
};

/** 环境变量后缀，如 FEISHU_SHEET_ADS_INSITE */
export const TABLE_ENV_SUFFIX: Record<TableKey, string> = {
  daily: 'DAILY',
  adsInsite: 'ADS_INSITE',
  adsOffsite: 'ADS_OFFSITE',
  products: 'PRODUCTS',
  keywords: 'KEYWORDS',
  targets: 'TARGETS',
};

export type TableTargets = Record<TableKey, string>;

export interface FeishuConfig {
  baseUrl: string;
  appId: string;
  appSecret: string;
  /**
   * 文档类型。配了 FEISHU_WIKI_TOKEN 时这个值只是兜底 ——
   * 真实类型以 wiki 节点返回的 obj_type 为准。
   */
  docType: FeishuDocType;
  /**
   * 知识库节点 token（链接里 /wiki/ 后面那一段）。
   * 配了它就不用再单独填 app_token / spreadsheet_token，同步时自动换算。
   */
  wikiToken: string;
  /**
   * 关键词表在另一个文档里时单独填它的 wiki token。
   * 留空就当它和主表在同一个文档。
   */
  keywordsWikiToken: string;
  /** 投放明细在另一个文档里时单独填（Insite-Ads Daily Report） */
  adsWikiToken: string;
  /** 多维表格：app_token + 各数据表的 table_id */
  bitable: { appToken: string; tables: TableTargets };
  /**
   * 电子表格：spreadsheet_token + 各子表。
   * 子表既可以写工作表名（「2.整体」），也可以写链接里的 sheet id（「awpfUO」）。
   */
  sheets: { spreadsheetToken: string; ranges: TableTargets };
}

function env(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

function readTargets(prefix: string): TableTargets {
  return TABLE_KEYS.reduce((acc, key) => {
    acc[key] = env(`${prefix}${TABLE_ENV_SUFFIX[key]}`);
    return acc;
  }, {} as TableTargets);
}

export function loadFeishuConfig(): FeishuConfig {
  const docType = env('FEISHU_DOC_TYPE', 'sheets') === 'bitable' ? 'bitable' : 'sheets';
  return {
    baseUrl: env('FEISHU_BASE_URL', 'https://open.feishu.cn/open-apis').replace(/\/+$/, ''),
    appId: env('FEISHU_APP_ID'),
    appSecret: env('FEISHU_APP_SECRET'),
    docType,
    wikiToken: env('FEISHU_WIKI_TOKEN'),
    keywordsWikiToken: env('FEISHU_WIKI_TOKEN_KEYWORDS'),
    adsWikiToken: env('FEISHU_WIKI_TOKEN_ADS'),
    bitable: {
      appToken: env('FEISHU_BITABLE_APP_TOKEN'),
      tables: readTargets('FEISHU_TABLE_'),
    },
    sheets: {
      spreadsheetToken: env('FEISHU_SPREADSHEET_TOKEN'),
      ranges: readTargets('FEISHU_SHEET_'),
    },
  };
}

/**
 * 凭证 + 一个能定位到文档的 token，才算「接了飞书」，否则回落到 mock 数据。
 * 具体哪张表、哪个子表可以等同步时再解析。
 */
export function isFeishuConfigured(cfg: FeishuConfig = loadFeishuConfig()): boolean {
  if (!cfg.appId || !cfg.appSecret) return false;
  if (cfg.wikiToken) return true;
  return cfg.docType === 'bitable'
    ? Boolean(cfg.bitable.appToken && cfg.bitable.tables.daily)
    : Boolean(cfg.sheets.spreadsheetToken);
}
