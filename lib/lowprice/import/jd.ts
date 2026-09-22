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

export function parseJdSearch(html: string): RawItem[] {
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
