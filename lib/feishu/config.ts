/**
 * 飞书数据源配置：全部走环境变量，方便本地 / Vercel / GitHub Actions 共用一套代码。
 * 见 .env.example。
 */

export type FeishuDocType = 'bitable' | 'sheets';

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
  /** 多维表格：app_token（形如 bascnXXXX）+ 各数据表的 table_id */
  bitable: {
    appToken: string;
    tables: {
      daily: string;
      channels: string;
      products: string;
      campaigns: string;
    };
  };
  /**
   * 电子表格：spreadsheet_token + 各子表。
   * 子表既可以写工作表名（「日报」），也可以写链接里的 sheet id（「7ngPBd」）。
   */
  sheets: {
    spreadsheetToken: string;
    ranges: {
      daily: string;
      channels: string;
      products: string;
      campaigns: string;
    };
  };
}

function env(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

export function loadFeishuConfig(): FeishuConfig {
  const docType = env('FEISHU_DOC_TYPE', 'bitable') === 'sheets' ? 'sheets' : 'bitable';
  return {
    baseUrl: env('FEISHU_BASE_URL', 'https://open.feishu.cn/open-apis').replace(/\/+$/, ''),
    appId: env('FEISHU_APP_ID'),
    appSecret: env('FEISHU_APP_SECRET'),
    docType,
    wikiToken: env('FEISHU_WIKI_TOKEN'),
    bitable: {
      appToken: env('FEISHU_BITABLE_APP_TOKEN'),
      tables: {
        daily: env('FEISHU_TABLE_DAILY'),
        channels: env('FEISHU_TABLE_CHANNELS'),
        products: env('FEISHU_TABLE_PRODUCTS'),
        campaigns: env('FEISHU_TABLE_CAMPAIGNS'),
      },
    },
    sheets: {
      spreadsheetToken: env('FEISHU_SPREADSHEET_TOKEN'),
      ranges: {
        daily: env('FEISHU_SHEET_DAILY'),
        channels: env('FEISHU_SHEET_CHANNELS'),
        products: env('FEISHU_SHEET_PRODUCTS'),
        campaigns: env('FEISHU_SHEET_CAMPAIGNS'),
      },
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
