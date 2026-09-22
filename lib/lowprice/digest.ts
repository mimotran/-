/**
 * 每周推送到飞书群的卡片。
 *
 * 口径全部走 rules.js，和看板页是同一份 —— 卡片上的数字必须能在看板上原样复现，
 * 否则群里看到的和点进去看到的对不上。
 *
 * 只报**国内版**：海外版价格体系和指导价都不一样，混在一起算低价率没有意义。
 */

import {
  applyFilters,
  collectDates,
  getDiscountRate,
  previousRange,
  sortRows,
  summarize,
} from './rules.js';
import type { LinkRecord } from './types';

/** 卡片只关心这两个平台，顺序就是卡片上的顺序 */
const PLATFORMS = ['淘宝', '京东'] as const;
const VERSION = '国内版';
const DASHBOARD = 'https://mimotran.github.io/-/links.html';

export interface DigestOptions {
  /** 推送当天的日期，决定标题里的「N月N日」。默认今天。 */
  pushDate?: Date;
  /** 每个平台取前几条 */
  topN?: number;
}

const md = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`;
const yuan = (v: number) => '¥' + Math.round(v).toLocaleString('en-US');
const pct = (v: number) => (v * 100).toFixed(1) + '%';

/**
 * 环比文案。比率类指标（低价占比）用**百分点**，不是「百分比的百分比」——
 * 24.5% 对 34.8% 是「降了 10.4 个百分点」，不是「降了 29.6%」。
 */
function delta(cur: number, prev: number | null, kind: 'ratio' | 'pt' = 'ratio'): string {
  if (prev === null) return '环比 —';
  if (kind === 'pt') {
    const x = (cur - prev) * 100;
    return `${x >= 0 ? '▲ +' : '▼ '}${x.toFixed(1)} pt`;
  }
  if (prev === 0) return cur === 0 ? '环比持平' : '环比 —';
  const x = ((cur - prev) / Math.abs(prev)) * 100;
  return `${x >= 0 ? '▲ +' : '▼ '}${x.toFixed(1)}%`;
}

const cell = (label: string, value: string | number, note: string) => ({
  tag: 'column',
  width: 'weighted',
  weight: 1,
  vertical_align: 'top',
  elements: [{ tag: 'markdown', content: `${label}\n**${value}**\n<font color="grey">${note}</font>` }],
});

function table(rows: LinkRecord[]) {
  return {
    tag: 'table',
    page_size: rows.length,
    row_height: 'low',
    header_style: {
      text_align: 'left', text_size: 'normal', background_style: 'grey',
      text_color: 'default', bold: true, lines: 1,
    },
    // 列宽不要写死：给过 40px，飞书直接拒了整个表格（低于最小列宽）
    columns: [
      { name: 'idx', display_name: '#', data_type: 'text' },
      { name: 'shop', display_name: '店铺', data_type: 'text' },
      { name: 'model', display_name: '型号', data_type: 'text' },
      { name: 'price', display_name: '售价', data_type: 'text' },
      { name: 'sales', display_name: '月销', data_type: 'text' },
      { name: 'link', display_name: '链接', data_type: 'lark_md' },
    ],
    rows: rows.map((r, i) => ({
      idx: String(i + 1),
      shop: r.shop || '—',
      model: (r.model || '').replace(/^PLAUD\s*/i, '') || '—',
      price: yuan(r.price ?? 0),
      sales: r.monthlySales == null ? '—' : String(r.monthlySales),
      link: r.url ? `[打开](${r.url})` : '—',
    })),
  };
}

export function buildDigestCard(all: LinkRecord[], options: DigestOptions = {}) {
  const topN = options.topN ?? 10;
  const dates = collectDates(all);
  const latest = dates[dates.length - 1];
  if (!latest) throw new Error('数据里没有可识别的排查日期');

  const scope = (from: string, to: string) =>
    applyFilters(all, { dateFrom: from, dateTo: to, version: VERSION });
  const cur = summarize(scope(latest, latest));
  const window = previousRange(dates, latest, latest);
  const prev = window ? summarize(scope(window.from, window.to)) : null;

  const pushDay = md(options.pushDate ?? new Date());
  const batchDay = md(new Date(`${latest}T00:00:00Z`));

  const elements: unknown[] = [
    { tag: 'markdown', content: `**排查批次 ${batchDay}**　·　▲▼ 环比上一批次` },
    {
      tag: 'column_set', horizontal_spacing: 'default',
      columns: [
        cell('在架链接', cur.records, delta(cur.records, prev && prev.records)),
        cell('低价链接', cur.low, delta(cur.low, prev && prev.low)),
        cell('低价占比', pct(cur.lowRate), `${delta(cur.lowRate, prev && prev.lowRate, 'pt')}　${cur.low} / ${cur.records}`),
      ],
    },
    {
      tag: 'column_set', horizontal_spacing: 'default',
      columns: [
        cell('涉及店铺', cur.shops, `在架共 ${cur.allShops} 家　${delta(cur.shops, prev && prev.shops)}`),
        cell('严重低价', cur.severe, delta(cur.severe, prev && prev.severe)),
        cell('低价均差', yuan(cur.avgLowGap), delta(cur.avgLowGap, prev && prev.avgLowGap)),
      ],
    },
  ];

  for (const platform of PLATFORMS) {
    const onPlatform = applyFilters(scope(latest, latest), { platform });
    const low = applyFilters(onPlatform, { lowPrice: 'low' });
    elements.push({ tag: 'hr' });
    elements.push({ tag: 'markdown', content: `**${platform} 低价链接 TOP${topN}**` });
    if (low.length === 0) {
      // 空表格比一句话难看，也让人以为是加载失败
      elements.push({
        tag: 'markdown',
        content: `本期${platform} ${onPlatform.length} 条在架链接中无低价链接。`,
      });
      continue;
    }
    // 这批低价链接的幅度几乎全是 19.2%，按幅度排等于随机；
    // 同样的折扣下月销高的影响更大，所以按月销降序。
    elements.push(table(sortRows(low, 'sales', 'desc').slice(0, topN)));
  }

  elements.push({ tag: 'hr' });
  elements.push({
    tag: 'markdown',
    content: `[查看完整看板 →](${DASHBOARD}?version=${encodeURIComponent(VERSION)})`,
  });

  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `【${pushDay} ${VERSION}低价链接监测数据同步】` },
      template: 'blue',
    },
    body: { elements },
  };
}

/** 给终端预览用的纯文本版，发之前先看一眼 */
export function describeDigest(all: LinkRecord[], options: DigestOptions = {}): string {
  const dates = collectDates(all);
  const latest = dates[dates.length - 1];
  const scope = applyFilters(all, { dateFrom: latest, dateTo: latest, version: VERSION });
  const cur = summarize(scope);
  const lines = [
    `批次 ${latest}　在架 ${cur.records}　低价 ${cur.low}　占比 ${pct(cur.lowRate)}` +
      `　店铺 ${cur.shops}/${cur.allShops}　严重 ${cur.severe}　均差 ${yuan(cur.avgLowGap)}`,
  ];
  for (const platform of PLATFORMS) {
    const onPlatform = applyFilters(scope, { platform });
    const low = applyFilters(onPlatform, { lowPrice: 'low' });
    lines.push(`\n${platform}：在架 ${onPlatform.length}，低价 ${low.length}`);
    for (const [i, r] of sortRows(low, 'sales', 'desc').slice(0, options.topN ?? 10).entries()) {
      lines.push(
        `  ${String(i + 1).padStart(2)}. ${(r.shop || '—').padEnd(20)} ${(r.model || '').replace(/^PLAUD\s*/i, '').padEnd(12)}` +
          ` ${yuan(r.price ?? 0).padStart(7)} ${pct(getDiscountRate(r) ?? 0).padStart(6)} 月销 ${String(r.monthlySales ?? '—').padStart(3)}` +
          `  ${(r.url || '').length} 字符`,
      );
    }
  }
  return lines.join('\n');
}
