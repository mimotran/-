/**
 * 把搜索页解析出来的商品分三桶，并给正品链接补上型号 / 版本 / 官方指导价。
 *
 *   keep     → 排查登记表（正品链接，含认不出型号的）
 *   knockoff → 同款仿品与蹭词
 *   drop     → 配件 / 服务 / 与 PLAUD 无关
 *
 * **搜索页显示的是最低 SKU 价，不一定是整机价** —— 上一批 ¥158 / ¥189 那几行就是这么来的。
 * 所以这里算出来的低价幅度只是候选值，每一行都会带上「需人工复核」的备注。
 */

import type { RawItem } from './types';

/** 官方指导价。改价时只改这里，别散落到各处。 */
export const LIST_PRICE: Record<string, { 国内版: number; 海外版: number }> = {
  'PLAUD NOTE': { 国内版: 999, 海外版: 999 },
  'PLAUD Note Pro': { 国内版: 1299, 海外版: 1399 },
  'PLAUD NotePin': { 国内版: 1299, 海外版: 1399 },
  'PLAUD NotePin S': { 国内版: 1299, 海外版: 1399 },
};

/**
 * 蹭词 / 仿品：标题里用「同款」「适用」「替代」，或干脆挂着别家品牌的名字。
 * 品牌名要列举 —— 「TWJUai智能录音笔…转写plaudNotePro」这种把 PLAUD 塞进功能描述里的，
 * 光看关键词分不出来，只能认出前面那个真正的品牌。遇到新的蹭词品牌就往这里加。
 */
const KNOCKOFF = /同款|适用|替代|TWJU|WITCEO|酷叮当|森拓思|拓思曼|GUSR|迈莱姆|得到\s*Getseed/i;

/** 配件 / 服务：不是整机，不该进排查表 */
const ACCESSORY = /充电线|数据线|贴膜|卡套|保护壳|手环|收纳|挂绳|会员|服务费|耗材|打印|戒指|电池/;

const OVERSEAS = /海外版|港版|国际版|香港行货|海外模型|海外大模型|跨境|global/i;

/**
 * 型号要同时在「保留空格」和「去掉空格」两种写法上试 ——
 * 标题里 NotePinS / Note Pin S / Pin S 三种写法都出现过。
 */
export function detectModel(title: string): string | null {
  const spaced = title.toLowerCase();
  const tight = title.replace(/\s+/g, '').toLowerCase();
  const hit = (re: RegExp) => re.test(spaced) || re.test(tight);
  if (hit(/note\s*pin\s*s\b/) || hit(/\bpin\s*s\b/) || hit(/notepins/)) return 'PLAUD NotePin S';
  if (hit(/note\s*pin\b/) || hit(/\bpin\b/)) return 'PLAUD NotePin';
  if (hit(/note\s*pro\b/)) return 'PLAUD Note Pro';
  if (hit(/\bnote\b/) || hit(/plaudnote/)) return 'PLAUD NOTE';
  return null;
}

export interface KeptRow {
  item: RawItem;
  model: string;
  version: string;
  listPrice: number | null;
  price: number;
  gap: number | null;
  rate: number | null;
  /** 非空表示这行有需要人工确认的地方 */
  review: string;
}

export interface Classified {
  keep: KeptRow[];
  knockoff: Array<{ item: RawItem; reason: string }>;
  drop: Array<{ item: RawItem; reason: string }>;
}

export interface ClassifyOptions {
  /** 按店名排除（例如官方旗舰店不算低价链接） */
  excludeShops?: string[];
}

export function classify(items: RawItem[], options: ClassifyOptions = {}): Classified {
  const excluded = new Set(options.excludeShops ?? []);
  const out: Classified = { keep: [], knockoff: [], drop: [] };

  for (const item of items) {
    const title = item.title || '';
    if (excluded.has(item.shop)) {
      out.drop.push({ item, reason: '按要求排除的店铺' });
      continue;
    }
    if (!/plaud|普拉德/i.test(title)) {
      out.drop.push({ item, reason: '标题里没有 PLAUD，非本品' });
      continue;
    }
    // 蹭词判定要排在配件之前：「迈莱姆WITCEO…会员」两边都沾，按品牌归类更准
    if (KNOCKOFF.test(title)) {
      out.knockoff.push({ item, reason: '「同款/适用/替代」表述或挂他牌，非 PLAUD 正品' });
      continue;
    }
    if (ACCESSORY.test(title)) {
      out.drop.push({ item, reason: '配件/服务，非整机' });
      continue;
    }

    const price = item.price as number;
    const model = detectModel(title);
    if (!model) {
      // 认不出型号的照样是在架链接，只是判不了低价 —— 型号/版本/指导价留空，
      // 看板会把它归进「缺口径」，计入总数但不计入低价统计。丢掉反而会让在架数偏少。
      out.keep.push({
        item, model: '', version: '', listPrice: null, price,
        gap: null, rate: null, review: '标题未标明型号，需人工判定',
      });
      continue;
    }
    const version = OVERSEAS.test(title) ? '海外版' : '国内版';
    const listPrice = LIST_PRICE[model][version as '国内版' | '海外版'];
    out.keep.push({
      item, model, version, listPrice, price,
      gap: listPrice - price,
      rate: (listPrice - price) / listPrice,
      review: '',
    });
  }
  return out;
}
