/**
 * 解析「另存为完整网页」的淘宝搜索页。
 *
 * 不用浏览器，直接按**源码顺序**扫标记。原因有两个：
 *   1. 少一个 playwright 依赖，CI 和别人的机器上都能跑；
 *   2. 淘宝把店铺链接 <a> 嵌在商品链接 <a> 里，而 HTML 不允许 a 嵌套 —— 浏览器解析时
 *      会提前闭合外层 a，店铺信息变成卡片的兄弟节点，在 DOM 里反而不好按「卡片的子节点」取。
 *      源码顺序里它就紧跟在那张卡后面，顺着扫最直接。
 *
 * class 名带哈希后缀（Title--title--wJY8TeA），一律用前缀匹配。
 */

import type { RawItem } from './types';

/** 每个标记各自一个捕获组，合起来做一次顺序扫描 */
const MARKERS = new RegExp(
  [
    '<a[^>]*\\bid="item_id_(\\d+)"([^>]*)>', // 1=商品ID 2=这个 a 标签的其余属性（判广告位用）
    '<div class="Title--title--[^"]*"[^>]*>([\\s\\S]*?)</div>', // 3=标题（内含高亮 span）
    'class="Price--priceInt--[^"]*">([^<]*)<', // 4=整数部分
    'class="Price--priceFloat--[^"]*">([^<]*)<', // 5=小数部分
    'class="Price--realSales--[^"]*">([^<]*)<', // 6=「82人付款」
    'class="Price--procity--[^"]*"><span>([^<]*)</span>', // 7=省 / 市，一张卡可能出现两次
    'class="ShopInfo--shopNameText--[^"]*">([^<]*)<', // 8=店名
  ].join('|'),
  'g',
);

const stripTags = (html: string) => html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

export function parseTaobaoSearch(html: string): RawItem[] {
  // 同一个商品会渲染出多张卡（广告位空壳 + 正常卡），价格在一张、店名在另一张，
  // 所以按 id **合并字段**而不是二选一 —— 二选一会把店名丢掉。
  const byId = new Map<string, RawItem & { _region: string[] }>();
  let cur: (RawItem & { _region: string[] }) | null = null;

  MARKERS.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKERS.exec(html)) !== null) {
    const [, id, attrs, title, priceInt, priceFloat, sales, procity, shop] = m;

    if (id) {
      cur =
        byId.get(id) ??
        ({
          platform: '淘宝',
          id,
          title: '',
          price: null,
          salesText: '',
          region: '',
          shop: '',
          isAd: false,
          url: `https://item.taobao.com/item.htm?id=${id}`,
          _region: [],
        } as RawItem & { _region: string[] });
      if (attrs && attrs.includes('click.simba.taobao.com')) cur.isAd = true;
      byId.set(id, cur);
      continue;
    }
    if (!cur) continue;

    if (title !== undefined && !cur.title) cur.title = decode(stripTags(title));
    if (priceInt !== undefined && cur.price === null) {
      cur.price = Number(priceInt.trim().replace(/[,，]/g, ''));
      if (!Number.isFinite(cur.price)) cur.price = null;
    }
    if (priceFloat !== undefined && cur.price !== null && Number.isInteger(cur.price)) {
      const frac = Number('0' + priceFloat.trim());
      if (Number.isFinite(frac) && frac > 0) cur.price = Number((cur.price + frac).toFixed(2));
    }
    if (sales !== undefined && !cur.salesText) cur.salesText = sales.trim();
    if (procity !== undefined && cur._region.length < 2 && procity.trim()) cur._region.push(procity.trim());
    if (shop !== undefined && !cur.shop) cur.shop = decode(shop.trim());
  }

  return [...byId.values()]
    .map(({ _region, ...item }) => ({ ...item, region: _region.join(' ') }))
    .filter((item) => item.price !== null);
}
