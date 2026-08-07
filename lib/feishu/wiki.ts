import { feishuGet } from './client';
import type { FeishuConfig } from './config';

/**
 * wiki 节点解析。
 *
 * 挂在知识库里的表格，链接长这样：
 *   https://<域名>.feishu.cn/wiki/<wiki_token>?sheet=<sheet_id>
 * 这里的 wiki_token **不是** spreadsheet_token，直接拿去调表格接口会 404。
 * 得先问 wiki 要真正的 obj_token，再用它读表。
 *
 * 应用需要被加进对应知识库的成员，否则这一步会返回权限错误。
 */

interface WikiNode {
  node?: {
    obj_token?: string;
    obj_type?: string;
    title?: string;
  };
}

export interface ResolvedWikiNode {
  objToken: string;
  /** sheet = 电子表格，bitable = 多维表格，docx = 文档 */
  objType: string;
  title: string;
}

const cache = new Map<string, ResolvedWikiNode>();

export async function resolveWikiNode(
  cfg: FeishuConfig,
  wikiToken: string,
): Promise<ResolvedWikiNode> {
  const cached = cache.get(wikiToken);
  if (cached) return cached;

  const data = await feishuGet<WikiNode>(
    '/wiki/v2/spaces/get_node',
    { token: wikiToken, obj_type: 'wiki' },
    cfg,
  );

  const objToken = data.node?.obj_token;
  const objType = data.node?.obj_type;
  if (!objToken || !objType) {
    throw new Error(
      `无法解析 wiki 节点 ${wikiToken}：请确认应用已被加入该知识库成员，且节点仍然存在`,
    );
  }

  const resolved: ResolvedWikiNode = { objToken, objType, title: data.node?.title ?? '' };
  cache.set(wikiToken, resolved);
  return resolved;
}

export function resetWikiCache(): void {
  cache.clear();
}

/** 从飞书链接里抠出 wiki_token 和 sheet id，方便直接把浏览器地址贴进环境变量 */
export function parseFeishuUrl(url: string): { wikiToken?: string; sheetId?: string; docToken?: string } {
  const result: { wikiToken?: string; sheetId?: string; docToken?: string } = {};

  const wiki = url.match(/\/wiki\/([A-Za-z0-9]+)/);
  if (wiki) result.wikiToken = wiki[1];

  const sheets = url.match(/\/sheets\/([A-Za-z0-9]+)/);
  if (sheets) result.docToken = sheets[1];

  const base = url.match(/\/base\/([A-Za-z0-9]+)/);
  if (base) result.docToken = base[1];

  const sheetId = url.match(/[?&]sheet=([A-Za-z0-9]+)/);
  if (sheetId) result.sheetId = sheetId[1];

  return result;
}
