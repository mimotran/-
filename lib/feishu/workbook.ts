/**
 * 解析「Y26 Plaud 天猫渠道日报」这本工作簿。
 *
 * 和 normalize.ts 里那套「按列名别名找列」的通用解析不同，这本表是人肉排版的：
 * 多行合并表头、一张表里混着月/周/日三种粒度、同名列在不同分组下出现六次。
 * 通用解析表达不了这种结构，所以这里按页签写死结构，用 grid.ts 提供的
 * 「合并表头 + 分段」能力去取数。
 *
 * 写死结构不是偷懒 —— 表头行号和分段标记都是运营手工维护的，一旦挪动，
 * 与其让别名匹配悄悄取到隔壁列，不如直接抛错，让人知道表改了。
 */

import type { FeishuConfig } from './config';
import { col, colIn, findSection, num, parseMonth, parseSheetDate, readGrid } from './grid';
import { listSheets } from './sheets';
import type {
  AdMetric,
  DailyMetric,
  DashboardSnapshot,
  ProductMetric,
  ProductLine,
  Target,
  TrafficChannelMetric,
} from '../types';

/** 页签标题 → 我们内部的用途。按标题找而不是写死 sheet_id，运营复制表也能用 */
const TAB_TITLES = {
  goals: '1.目标达成',
  overall: '2.整体',
  insite: '3.投放-站内',
  offsite: '4.投放-站外',
  traffic: '6.流量',
  productDetail: '附-产品',
} as const;

/** 日明细分段的标记：同一本表里三种写法都出现过 */
const DAILY_MARKERS = [/^日明细/, /^日汇总/, /^每日数据/];

/** 站内触点。顺序照表里从左到右，页面上的排序跟着它 */
const INSITE_TOUCHPOINTS = ['Search_品牌词', 'Search_品类词', 'Search_其他', 'Branding', 'Video', 'Display'];
/** 站外渠道 */
const OFFSITE_CHANNELS = ['抖音CID', '小红书CID', 'B站CID-天猫分摊', 'UD', '腾讯'];
/** 流量来源。「汇总」不在其中 —— 它是这几路的和，混进来会让占比翻倍 */
const TRAFFIC_CHANNELS = [
  '搜索', '推荐', '付费-店铺直达（品专）', '付费-关键词推广', '付费-淘宝客', '付费-短视频',
];

/** 商品名里的转义引号是从别处复制粘贴带进来的，展示前清掉，不然表格里全是 \" */
const cleanTitle = (t: string) => t.replace(/\\(["'])/g, '$1').trim();

/** 附-产品里的 spu 名 → 产品线。认不出的一律归配件，不猜 */
function resolveLine(spu: string): ProductLine {
  const s = spu.trim();
  if (/^note\s*pro/i.test(s)) return 'pro';
  if (/^notepin/i.test(s)) return 'pins';
  if (/^note$/i.test(s)) return 'note';
  if (/会员|年卡|季卡|服务/.test(s)) return 'member';
  return 'accessory';
}

export async function readWorkbook(
  cfg: FeishuConfig,
  spreadsheetToken: string,
  year: number,
): Promise<DashboardSnapshot> {
  const warnings: string[] = [];
  const sheets = await listSheets(cfg, spreadsheetToken);
  const idOf = (title: string) => {
    const hit = sheets.find((s) => s.title === title);
    if (!hit) throw new Error(`工作簿里找不到页签「${title}」，现有：${sheets.map((s) => s.title).join('、')}`);
    return hit.sheetId;
  };

  // ---- 2.整体：日报主干 -----------------------------------------------------
  const overall = await readGrid(cfg, spreadsheetToken, idOf(TAB_TITLES.overall), {
    headerRow: 4, lastRow: 460, lastCol: 'BZ',
  });
  const overallStart = findSection(overall, DAILY_MARKERS);
  if (overallStart < 0) throw new Error('「2.整体」里找不到「日明细」分段标记，表结构变了');

  const O = (name: string) => {
    const i = col(overall, name);
    if (i < 0) warnings.push(`「2.整体」缺列「${name}」，按 0 处理`);
    return i;
  };
  const cGmv = O('GMV'), cSales = O('主机销量'), cAfter = O('退后GMV'), cUv = O('UV');
  const cBuyers = O('支付人数'), cCart = O('加购人数'), cRefund = O('退款金额'), cNewRate = O('新客率');
  const cInCost = O('站内消耗'), cInRoi = O('站内ROI'), cOutCost = O('站外消耗'), cOutRoi = O('站外ROI');

  const daily: DailyMetric[] = [];
  const seen = new Set<string>();
  for (let r = overallStart + 1; r < overall.rows.length; r++) {
    const row = overall.rows[r];
    const date = parseSheetDate(row[1], year);
    if (!date) continue;

    const gmv = num(row[cGmv]);
    /**
     * 未来的日期在表里已经排好行了，只是还没数。
     * 不剔掉的话「昨日」会指向 12 月 31 日、全部指标显示 0，
     * 而且全年累计的分母被撑到 365 天，日均全线腰斩。
     */
    if (gmv === 0 && num(row[cUv]) === 0) continue;

    if (seen.has(date)) { warnings.push(`「2.整体」日明细里 ${date} 有重复行，以最后一行为准`); }
    seen.add(date);

    const inCost = num(row[cInCost]);
    const outCost = num(row[cOutCost]);
    daily.push({
      date,
      campaign: (row[0] ?? '').trim() || '日常',
      gmv,
      deviceSales: num(row[cSales]),
      gmvAfterRefund: num(row[cAfter]),
      refund: num(row[cRefund]),
      uv: num(row[cUv]),
      buyers: num(row[cBuyers]),
      addToCart: num(row[cCart]),
      // 表里给的是新客率，模型存的是绝对值 —— 比率要能跨区间加权汇总，只能靠绝对值
      newCustomerGmv: num(row[cNewRate]) * gmv,
      adCostInsite: inCost,
      adCostOffsite: outCost,
      // 成交额表里没有单列，用消耗 × ROI 还原（表里的 ROI 就是这么定义的）
      adGmvInsite: inCost * num(row[cInRoi]),
      adGmvOffsite: outCost * num(row[cOutRoi]),
      searchUv: 0, searchBuyers: 0, searchGmv: 0, paidUv: 0, paidGmv: 0,
    });
  }
  if (daily.length === 0) throw new Error('「2.整体」日明细一行都没解析出来，检查日期列格式');
  const byDate = new Map(daily.map((d) => [d.date, d]));

  // ---- 6.流量：把搜索 / 付费的量补进日报，并拆出来源明细 ---------------------
  const traffic = await readGrid(cfg, spreadsheetToken, idOf(TAB_TITLES.traffic), {
    headerRow: 3, groupRows: [2], lastRow: 460, lastCol: 'BZ',
  });
  const trafficStart = findSection(traffic, DAILY_MARKERS);
  const trafficChannels: TrafficChannelMetric[] = [];

  if (trafficStart < 0) {
    warnings.push('「6.流量」找不到日明细分段，搜索与付费流量按 0 处理');
  } else {
    const tSearchUv = colIn(traffic, '总搜索', '搜索访客');
    const tSearchGmv = colIn(traffic, '总搜索', '搜索成交');
    const tSearchCvr = colIn(traffic, '总搜索', '支付转化率');
    const tPaidUv = colIn(traffic, '总付费流量', 'UV');
    const tPaidGmv = colIn(traffic, '总付费流量', '付费成交');

    const chanCols = TRAFFIC_CHANNELS.map((ch) => ({
      channel: ch,
      uv: colIn(traffic, ch, '访客数(uv)'),
      buyers: colIn(traffic, ch, '支付人数'),
      gmv: colIn(traffic, ch, '支付金额'),
    })).filter((c) => {
      if (c.uv < 0) { warnings.push(`「6.流量」找不到来源「${c.channel}」，已跳过`); return false; }
      return true;
    });

    for (let r = trafficStart + 1; r < traffic.rows.length; r++) {
      const row = traffic.rows[r];
      const date = parseSheetDate(row[0], year);
      if (!date) continue;

      const d = byDate.get(date);
      if (d) {
        d.searchUv = num(row[tSearchUv]);
        d.searchGmv = num(row[tSearchGmv]);
        // 搜索支付人数表里没有单列，用搜索转化率 × 搜索访客还原
        d.searchBuyers = Math.round(num(row[tSearchCvr]) * d.searchUv);
        d.paidUv = num(row[tPaidUv]);
        d.paidGmv = num(row[tPaidGmv]);
      }

      for (const c of chanCols) {
        const uv = num(row[c.uv]);
        const gmv = c.gmv >= 0 ? num(row[c.gmv]) : 0;
        if (uv === 0 && gmv === 0) continue;
        trafficChannels.push({
          date, channel: c.channel, uv,
          buyers: c.buyers >= 0 ? num(row[c.buyers]) : 0,
          gmv,
        });
      }
    }
  }

  // ---- 3 / 4：投放明细 ------------------------------------------------------
  const ads: AdMetric[] = [];

  const insite = await readGrid(cfg, spreadsheetToken, idOf(TAB_TITLES.insite), {
    headerRow: 4, groupRows: [2, 3], lastRow: 460, lastCol: 'CZ',
  });
  const insiteStart = findSection(insite, DAILY_MARKERS);
  if (insiteStart < 0) {
    warnings.push('「3.投放-站内」找不到日明细分段，站内触点拆解为空');
  } else {
    for (const tp of INSITE_TOUCHPOINTS) {
      const costC = colIn(insite, tp, 'SPD');
      if (costC < 0) { warnings.push(`「3.投放-站内」找不到触点「${tp}」，已跳过`); continue; }
      const gmvC = colIn(insite, tp, 'Sales');
      const ordC = colIn(insite, tp, 'Order');
      const impC = colIn(insite, tp, 'IMP');
      const clkC = colIn(insite, tp, 'Click');
      for (let r = insiteStart + 1; r < insite.rows.length; r++) {
        const row = insite.rows[r];
        const date = parseSheetDate(row[0], year);
        if (!date) continue;
        const cost = num(row[costC]);
        const gmv = gmvC >= 0 ? num(row[gmvC]) : 0;
        if (cost === 0 && gmv === 0) continue;
        ads.push({
          date, scope: 'insite', channel: tp, cost, gmv,
          orders: ordC >= 0 ? num(row[ordC]) : 0,
          impressions: impC >= 0 ? num(row[impC]) : 0,
          clicks: clkC >= 0 ? num(row[clkC]) : 0,
        });
      }
    }
  }

  const offsite = await readGrid(cfg, spreadsheetToken, idOf(TAB_TITLES.offsite), {
    headerRow: 3, groupRows: [2], lastRow: 460, lastCol: 'BZ',
  });
  const offsiteStart = findSection(offsite, DAILY_MARKERS);
  if (offsiteStart < 0) {
    warnings.push('「4.投放-站外」找不到日汇总分段，站外渠道拆解为空');
  } else {
    for (const ch of OFFSITE_CHANNELS) {
      const costC = colIn(offsite, ch, '推广消耗');
      if (costC < 0) { warnings.push(`「4.投放-站外」找不到渠道「${ch}」，已跳过`); continue; }
      const gmvC = colIn(offsite, ch, '成交金额');
      const impC = colIn(offsite, ch, '展现量');
      const clkC = colIn(offsite, ch, '点击量');
      const cvrC = colIn(offsite, ch, 'CVR');
      for (let r = offsiteStart + 1; r < offsite.rows.length; r++) {
        const row = offsite.rows[r];
        const date = parseSheetDate(row[0], year);
        if (!date) continue;
        const cost = num(row[costC]);
        const gmv = gmvC >= 0 ? num(row[gmvC]) : 0;
        if (cost === 0 && gmv === 0) continue;
        const clicks = clkC >= 0 ? num(row[clkC]) : 0;
        ads.push({
          date, scope: 'offsite', channel: ch, cost, gmv,
          // 站外表不给成交单数，用 CVR × 点击还原；两者都没有就留 0
          orders: cvrC >= 0 ? Math.round(num(row[cvrC]) * clicks) : 0,
          impressions: impC >= 0 ? num(row[impC]) : 0,
          clicks,
        });
      }
    }
  }

  // ---- 附-产品：商品级日明细，产品线由它汇总而来 -----------------------------
  const prodGrid = await readGrid(cfg, spreadsheetToken, idOf(TAB_TITLES.productDetail), {
    headerRow: 1, lastRow: 6000, lastCol: 'AZ',
  });
  const pSpu = col(prodGrid, 'spu');
  const pDate = col(prodGrid, '统计日期');
  const pId = col(prodGrid, '商品ID');
  const pTitle = col(prodGrid, '商品名称');
  const pUv = col(prodGrid, '商品访客数');
  const pQty = col(prodGrid, '支付件数');
  const pGmv = col(prodGrid, '支付金额');
  const pRefund = col(prodGrid, '成功退款金额');

  const products: ProductMetric[] = [];
  for (let r = 1; r < prodGrid.rows.length; r++) {
    const row = prodGrid.rows[r];
    const date = parseSheetDate(row[pDate], year);
    if (!date) continue;
    const gmv = num(row[pGmv]);
    const uv = num(row[pUv]);
    if (gmv === 0 && uv === 0) continue;
    products.push({
      date,
      line: resolveLine(row[pSpu] ?? ''),
      itemId: (row[pId] ?? '').trim() || (row[pTitle] ?? '').trim(),
      title: cleanTitle(row[pTitle] ?? '') || cleanTitle(row[pSpu] ?? ''),
      gmv,
      quantity: num(row[pQty]),
      uv,
      refund: num(row[pRefund]),
    });
  }
  if (products.length === 0) warnings.push('「附-产品」一行都没解析出来，产品板块会是空的');

  // ---- 1.目标达成：月度目标 -------------------------------------------------
  const goalGrid = await readGrid(cfg, spreadsheetToken, idOf(TAB_TITLES.goals), {
    headerRow: 3, groupRows: [2], lastRow: 60, lastCol: 'BZ',
  });
  const gMonth = 2; // C 列是月份
  const tGmv = colIn(goalGrid, '渠道目标', 'GMV');
  const tSales = colIn(goalGrid, '渠道目标', '主机销量');
  const tCost = colIn(goalGrid, '渠道目标', '总费用');
  const tCostRate = colIn(goalGrid, '渠道目标', '总费比');

  const targets: Target[] = [];
  if (tGmv < 0) {
    warnings.push('「1.目标达成」找不到「渠道目标」分组，目标达成板块会没有目标线');
  } else {
    for (let r = 0; r < goalGrid.rows.length; r++) {
      const month = parseMonth(goalGrid.rows[r][gMonth]);
      if (month === null) continue;
      const values: Record<string, number> = {};
      const put = (k: string, c: number) => { if (c >= 0) { const v = num(goalGrid.rows[r][c]); if (v > 0) values[k] = v; } };
      put('gmv', tGmv);
      put('deviceSales', tSales);
      put('adCost', tCost);
      put('adCostRate', tCostRate);
      if (Object.keys(values).length) {
        targets.push({ period: 'month', key: `${year}-${String(month).padStart(2, '0')}`, values });
      }
    }
  }

  const dates = daily.map((d) => d.date).sort();
  return {
    source: 'feishu-sheets',
    syncedAt: new Date().toISOString(),
    coverage: { from: dates[0], to: dates[dates.length - 1] },
    daily: daily.sort((a, b) => a.date.localeCompare(b.date)),
    ads,
    products,
    trafficChannels,
    targets,
    warnings,
  };
}
