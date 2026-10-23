/**
 * 解析「另存为完整网页」的京东搜索页（re.jd.com 落地页）。
 *
 * 京东把每张卡的完整数据塞在 data-item 属性里的一段 JSON 中 —— 直接读它，
 * 比扒 DOM 稳得多，而且能拿到淘宝页拿不到的 shopId / venderId / 自营标记。
 */

import type { RawItem } from './types';

const DATA_ITEM = /data-item="([^"]*)"/g;

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&'); // &amp; 放最后，否则 &amp;quot; 会被拆成两步解错

/**
 * 京东主站搜索（search.jd.com，2026-10 起）—— 没有 data-item，字段散在带哈希的 class 里：
 *   卡片   plugin_goodsCardWrapper … data-sku="100304471011"
 *   标题   _goods_title_container_xxx 里第一个 <span title="…">
 *   售价   _price_xxx 里的 <span>1139</span>，旁边是 _subsidy_xxx「到手价」和 _gray_xxx 划线价
 *   店名   _name_xxx > _limit_xxx
 *   销量   _goods_volume_xxx 里的 title="已售2000+"
 * class 后缀的哈希每次发版都会变，所以只认前缀（_price_ + 任意哈希 + _数字）。
 *
 * 售价取页面上的大字价（多数是「到手价」= 券后实付），和淘宝搜索页口径一致；
 * 划线价记在 listedText 里，导入时写进备注，方便人工核验。
 */
function parseJdMainSearch(html: string): RawItem[] {
  const out: RawItem[] = [];
  const starts: number[] = [];
  const CARD = /class="[^"]*plugin_goodsCardWrapper[^"]*"[^>]*data-sku="(\d+)"/g;
  let m: RegExpExecArray | null;
  const skus: string[] = [];
  while ((m = CARD.exec(html)) !== null) { starts.push(m.index); skus.push(m[1]); }
  const cls = (name: string) => `class="_${name}_[a-z0-9]+_\\d+[^"]*"`;
  const pick = (seg: string, re: RegExp) => seg.match(re)?.[1]?.trim() ?? '';

  for (let i = 0; i < starts.length; i++) {
    const seg = html.slice(starts[i], starts[i + 1] ?? starts[i] + 20000);
    const id = skus[i];
    const titleBlock = seg.match(new RegExp(`${cls('goods_title_container')}[\\s\\S]*?<span title="([^"]*)"`));
    const priceText = pick(seg, new RegExp(`${cls('price')}[\\s\\S]*?<span>([\\d.,]+)</span>`));
    const price = priceText ? Number(priceText.replace(/,/g, '')) : null;
    const title = decode(titleBlock?.[1] ?? '');
    const isSelfRun = /alt="自营"/.test(seg.slice(0, seg.indexOf('<span title=') + 1 || 3000));
    let shop = decode(pick(seg, new RegExp(`${cls('name')}><span ${cls('limit')}[^>]*>([^<]*)<`)));
    // 京东自营的卡片经常不显示店名（只剩一个客服图标）。PLAUD 在京东的自营就两家：
    // 官方的 PLAUD京东自营旗舰店，和钉钉联名款走的钉钉自营。往期手工记录对得上
    // （同一批 SKU 当时记的是「PLAUD」「钉钉」）。按标题推断，导入时备注里注明。
    let shopInferred = false;
    if (!shop && isSelfRun) {
      if (/^钉钉/.test(title)) { shop = '钉钉（京东自营）'; shopInferred = true; }
      else if (/plaud/i.test(title)) { shop = 'PLAUD京东自营旗舰店'; shopInferred = true; }
    }
    out.push({
      platform: '京东',
      id,
      title,
      price: Number.isFinite(price as number) ? price : null,
      salesText: pick(seg, new RegExp(`${cls('goods_volume')}[\\s\\S]*?title="([^"]*)"`)),
      heatText: '',
      region: '',
      shop,
      shopInferred,
      isSelfRun,
      isAd: new RegExp(`${cls('ad')}>广告<`).test(seg),
      priceLabel: pick(seg, new RegExp(`${cls('subsidy')}>([^<]+)<`)),
      listedText: pick(seg, new RegExp(`${cls('gray')}[^>]*>¥?([\\d.,]+)<`)),
      url: `https://item.jd.com/${id}.html`,
    });
  }
  return out.filter((item) => item.price !== null);
}

export function parseJdSearch(html: string): RawItem[] {
  // 两代页面：re.jd.com 落地页每张卡带 data-item JSON；search.jd.com 主站没有
  if (!/data-item="/.test(html) && /plugin_goodsCardWrapper/.test(html)) return parseJdMainSearch(html);
  const out: RawItem[] = [];
  DATA_ITEM.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DATA_ITEM.exec(html)) !== null) {
    let d: Record<string, unknown>;
    try {
      d = JSON.parse(decode(m[1]));
    } catch {
      continue; // 个别卡片的 JSON 被截断过，跳过而不是让整页失败
    }
    const id = String(d.id ?? '');
    if (!id) continue;
    const price = d.price === '' || d.price == null ? null : Number(d.price);
    out.push({
      platform: '京东',
      id,
      title: String(d.title ?? ''),
      price: Number.isFinite(price as number) ? (price as number) : null,
      salesText: String(d.monthSales ?? ''),
      heatText: String(d.cc ?? ''),
      region: '', // 京东搜索页不给发货地，既有数据里这一列也是空的
      shop: String(d.shopName ?? ''),
      isSelfRun: String(d.zy) === '1',
      url: String(d.landUrl || `https://item.jd.com/${id}.html`),
    });
  }
  return out.filter((item) => item.price !== null);
}
