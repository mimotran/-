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
  AdTotal,
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

/**
 * 测试商品不进数据。
 *
 * 店铺里挂着「"测试商品，请不要拍，拍下无效" Plaud 会员」这种链接，金额只有几十块，
 * 但它会占掉单链接排行的一整行，还把「会员」这条产品线撑出一个没意义的数。
 * 在解析阶段剔掉，比在每个展示处各过滤一遍可靠。
 */
const TEST_ITEM = /测试商品|请不要拍|拍下无效|勿拍|test\s*item/i;

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
  /**
   * 两张投放表自己的「汇总」块，按日读一份。
   *
   * 为什么不直接把渠道加起来：消耗 / 成交 / 展现 / 点击加起来和汇总列分毫不差，
   * **成交单数不行**。站外表压根没有成交单数列，只有 CVR，而渠道级 CVR 和汇总
   * 级 CVR 是两套数 —— 1 月按渠道还原是 4.9%，汇总列写的是 2.8%。哪个对不由
   * 我们判断，但看板上要展示的是「源表汇总块里的数」，那就照着汇总块读。
   */
  const adTotals: AdTotal[] = [];

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

  // 站内汇总块：时间 / GMV / 推广消耗 / 成交金额 / 成交单数 / ROI / 转化率 / 展现量 / 点击量 / …
  if (insiteStart >= 0) {
    const g = (name: string) => colIn(insite, '站内投放汇总', name);
    const cShopGmv = g('GMV'), cCost = g('推广消耗'), cGmv = g('成交金额');
    const cOrders = g('成交单数'), cImp = g('展现量'), cClk = g('点击量');
    for (let r = insiteStart + 1; r < insite.rows.length; r++) {
      const row = insite.rows[r];
      const date = parseSheetDate(row[0], year);
      if (!date) continue;
      const cost = cCost >= 0 ? num(row[cCost]) : 0;
      const gmv = cGmv >= 0 ? num(row[cGmv]) : 0;
      if (cost === 0 && gmv === 0) continue;
      adTotals.push({
        date, scope: 'insite', cost, gmv,
        orders: cOrders >= 0 ? num(row[cOrders]) : 0,
        impressions: cImp >= 0 ? num(row[cImp]) : 0,
        clicks: cClk >= 0 ? num(row[cClk]) : 0,
        shopGmv: cShopGmv >= 0 ? num(row[cShopGmv]) : 0,
      });
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

  // 站外汇总块：时间 / 推广消耗 / 成交金额 / ROI / 展现量 / 点击量 / CPM / CVR / CPC
  if (offsiteStart >= 0) {
    const g = (name: string) => colIn(offsite, '站外汇总', name);
    const cCost = g('推广消耗'), cGmv = g('成交金额');
    const cImp = g('展现量'), cClk = g('点击量'), cCvr = g('CVR');
    for (let r = offsiteStart + 1; r < offsite.rows.length; r++) {
      const row = offsite.rows[r];
      const date = parseSheetDate(row[0], year);
      if (!date) continue;
      const cost = cCost >= 0 ? num(row[cCost]) : 0;
      const gmv = cGmv >= 0 ? num(row[cGmv]) : 0;
      if (cost === 0 && gmv === 0) continue;
      const clicks = cClk >= 0 ? num(row[cClk]) : 0;
      adTotals.push({
        date, scope: 'offsite', cost, gmv,
        // 站外汇总块没有成交单数列，用它自己的 CVR × 点击量还原，跨区间才好加总
        orders: cCvr >= 0 ? num(row[cCvr]) * clicks : 0,
        impressions: cImp >= 0 ? num(row[cImp]) : 0,
        clicks,
        shopGmv: 0,
      });
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
  const pBuyers = col(prodGrid, '支付买家数');
  const pGmv = col(prodGrid, '支付金额');
  const pRefund = col(prodGrid, '成功退款金额');

  const products: ProductMetric[] = [];
  let skippedTest = 0;
  let skippedGmv = 0;
  const excludedProductGmv: Record<string, number> = {};
  for (let r = 1; r < prodGrid.rows.length; r++) {
    const row = prodGrid.rows[r];
    const date = parseSheetDate(row[pDate], year);
    if (!date) continue;
    const gmv = num(row[pGmv]);
    const uv = num(row[pUv]);
    if (gmv === 0 && uv === 0) continue;
    const title = cleanTitle(row[pTitle] ?? '') || cleanTitle(row[pSpu] ?? '');
    if (TEST_ITEM.test(title)) {
      skippedTest += 1; skippedGmv += gmv;
      excludedProductGmv[date] = (excludedProductGmv[date] ?? 0) + gmv;
      continue;
    }
    products.push({
      date,
      line: resolveLine(row[pSpu] ?? ''),
      itemId: (row[pId] ?? '').trim() || (row[pTitle] ?? '').trim(),
      title,
      gmv,
      quantity: num(row[pQty]),
      buyers: pBuyers >= 0 ? num(row[pBuyers]) : 0,
      uv,
      refund: num(row[pRefund]),
    });
  }
  if (products.length === 0) warnings.push('「附-产品」一行都没解析出来，产品板块会是空的');
  // 把剔掉的金额也报出来 —— 商品明细之和会因此比日报少这么多，是预期内的
  if (skippedTest > 0) {
    warnings.push(`已剔除 ${skippedTest} 行测试商品（合计 ¥${Math.round(skippedGmv).toLocaleString('zh-CN')}）`);
  }

  // ---- 1.目标达成：右侧「项目」区块给出每月的目标和实际 ---------------------
  /**
   * 版式是「区块 | 指标名 | (1月 目标/实际/达成率/上月MTD/MTD环比) | (2月 …) …」，
   * 一行一个指标、按月横向铺开 —— 和别的页签「一行一天」正好转置了，
   * 所以这里单独走一套解析，不复用上面的按行取数。
   */
  const goalGrid = await readGrid(cfg, spreadsheetToken, idOf(TAB_TITLES.goals), {
    headerRow: 3, lastRow: 40, lastCol: 'DZ',
  });

  /** 表里的指标名 → 模型里的 key。认不出的行直接跳过，不猜 */
  const GOAL_KEY_BY_LABEL: Record<string, string> = {
    'GMV': 'gmv',
    '销量': 'deviceSales',
    '退款率': 'refundRate',
    '站内投放费': 'adCostInsite',
    '站内ROI': 'roiInsite',
    '站内费比': 'adCostRateInsite',
    '站外投放费': 'adCostOffsite',
    '站外ROI': 'roiOffsite',
    '站外费比': 'adCostRateOffsite',
    '总投放费': 'adCost',
    '总费比': 'adCostRate',
    '利润（预估）': 'grossProfit',
    '利润率（GMV）': 'profitRate',
    '搜索UV': 'searchUv',
    '搜索转化率': 'searchConversionRate',
  };

  const targets: Target[] = [];
  const monthlyActuals: Record<string, Record<string, number>> = {};

  const setTarget = (monthStr: string, key: string, value: number) => {
    let t = targets.find((x) => x.key === monthStr);
    if (!t) { t = { period: 'month', key: monthStr, values: {} }; targets.push(t); }
    t.values[key] = value;
  };

  /**
   * 左侧「月汇总」区块：一行一个月，**十二个月全在这儿**。
   *
   * 右边那个按月展开的「项目」区块只铺到当月 —— 只读它的话，「Q3 目标」就成了
   * 7+8 月、「全年目标」成了 1–8 月，季度和年度口径全是错的。这个区块给的是
   * 已经拆好的月度计划（含 9–12 月），所以先按它把每个月的目标填满，
   * 再让右边的明细覆盖上去（两边重合的月份数值一致，覆盖只是取更细的那份）。
   *
   * 它只有五个指标：GMV / 主机销量 / 总费用 / 总费比 / 利润。站内外的拆分目标
   * 未来月份确实没排，所以那几行在季度 / 年度口径下就该显示「—」，不该拿
   * 已排的几个月硬凑一个数当成全周期目标。
   */
  const SUMMARY_TARGET_KEYS: Record<string, string> = {
    'GMV': 'gmv',
    '主机销量': 'deviceSales',
    '总费用': 'adCost',
    '总费比': 'adCostRate',
    '利润': 'grossProfit',
  };
  {
    const groupRow = goalGrid.rows[goalGrid.headerRow - 1] ?? [];
    const head = goalGrid.rows[goalGrid.headerRow] ?? [];
    const monthLabelCol = groupRow.findIndex((c) => c.trim() === '月汇总');
    const planStart = groupRow.findIndex((c) => c.trim() === '渠道目标');
    // 「渠道目标」右边的下一个分组名就是它的右边界（这里是「实际达成」）
    let planEnd = groupRow.length;
    for (let c = planStart + 1; c < groupRow.length; c++) {
      if (groupRow[c].trim() && groupRow[c].trim() !== '渠道目标') { planEnd = c; break; }
    }

    if (monthLabelCol < 0 || planStart < 0) {
      warnings.push('「1.目标达成」左侧没找到「月汇总 / 渠道目标」区块，9 月以后的目标会缺');
    } else {
      const cols: Array<{ key: string; col: number }> = [];
      for (let c = planStart; c < planEnd; c++) {
        const key = SUMMARY_TARGET_KEYS[(head[c] ?? '').trim()];
        if (key) cols.push({ key, col: c });
      }
      let months = 0;
      /** 逐月累加，回头和表里那行 YTD 对一下 —— 少读一个月这里立刻就露馅 */
      const monthSum: Record<string, number> = {};
      let ytdRow: string[] | null = null;

      for (let r = goalGrid.headerRow + 1; r < goalGrid.rows.length; r++) {
        const row = goalGrid.rows[r];
        const label = (row[monthLabelCol] ?? '').trim();
        if (label === 'YTD') ytdRow = row;
        const month = parseMonth(label);
        // YTD / Q1 / H1 这些汇总行的标签不是「N月」，parseMonth 认不出，自然跳过
        if (month === null) continue;
        const monthStr = `${year}-${String(month).padStart(2, '0')}`;
        let hit = false;
        for (const { key, col: c } of cols) {
          const v = num(row[c]);
          if (v !== 0) {
            setTarget(monthStr, key, v);
            monthSum[key] = (monthSum[key] ?? 0) + v;
            hit = true;
          }
        }
        if (hit) months += 1;
      }
      if (months < 12) {
        warnings.push(`「1.目标达成」月汇总只解析出 ${months} 个月的目标，季度 / 全年口径会缺月`);
      }

      /**
       * 和表自己那行 YTD 对账。
       *
       * 「十二个月都读到了」和「读对了」是两件事：漏一行、串一列，月份数照样是 12。
       * 表里正好给了 YTD 合计，拿它当校验和，比任何断言都可靠。费比是率，不能相加，
       * 所以只对绝对量。
       */
      if (ytdRow) {
        for (const { key, col: c } of cols) {
          if (key === 'adCostRate') continue;
          const want = num(ytdRow[c]);
          const got = monthSum[key] ?? 0;
          if (want > 0 && Math.abs(want - got) > Math.max(1, want * 0.005)) {
            warnings.push(`「1.目标达成」月汇总的 ${key} 十二个月合计 ${Math.round(got)}，与表里 YTD 行 ${Math.round(want)} 对不上`);
          }
        }
      }
    }
  }

  // 月份表头在表头行的上一行，每个月占 5 列（目标/实际/达成率/上月MTD/MTD环比）
  const monthRow = goalGrid.rows[goalGrid.headerRow - 1] ?? [];
  const monthCols: Array<{ month: number; col: number }> = [];
  monthRow.forEach((cell, c) => {
    const m = parseMonth(cell);
    if (m !== null) monthCols.push({ month: m, col: c });
  });

  if (monthCols.length === 0) {
    warnings.push('「1.目标达成」右侧没找到按月展开的「项目」区块，目标达成板块会没有目标线');
  } else {
    const header = goalGrid.rows[goalGrid.headerRow] ?? [];
    // 「项目」那一列右边就是指标名列
    const projectCol = header.findIndex((h) => h.trim() === '项目');
    const labelCol = projectCol >= 0 ? projectCol + 1 : -1;

    for (let r = goalGrid.headerRow + 1; r < goalGrid.rows.length; r++) {
      const row = goalGrid.rows[r];
      // 利润那两行的名字写在「区块」列里、指标名列是空的，所以两列都要看
      const label = (row[labelCol] || row[projectCol] || '').trim();
      const key = GOAL_KEY_BY_LABEL[label];
      if (!key) continue;

      for (const { month, col: mc } of monthCols) {
        const monthStr = `${year}-${String(month).padStart(2, '0')}`;
        const targetVal = num(row[mc]);
        const actualVal = num(row[mc + 1]);

        if (targetVal !== 0) {
          // 两个区块都给了同一个数就得对得上，对不上说明表被改过一处漏了一处
          const prev = targets.find((x) => x.key === monthStr)?.values[key];
          if (prev !== undefined && Math.abs(prev - targetVal) > Math.max(1, Math.abs(prev) * 0.01)) {
            warnings.push(`「1.目标达成」${monthStr} 的${label}目标两处不一致：月汇总 ${prev}，项目明细 ${targetVal}，以明细为准`);
          }
          setTarget(monthStr, key, targetVal);
        }
        // 实际值只留没有日明细的那些；其余一律从日报聚合，免得同一个数两处口径打架
        if (key === 'grossProfit' && actualVal !== 0) {
          (monthlyActuals[monthStr] ??= {})[key] = actualVal;
        }
      }
    }

    /**
     * 绝对值目标要和率目标自洽。
     * 表里只给了退款率和搜索转化率的目标，没给退款金额和搜索支付人数 ——
     * 但页面上这两行的主指标是绝对值，缺了目标整行就变成「—」。
     * 用「率目标 × 对应分母目标」补出来，两边永远一致。
     */
    for (const t of targets) {
      const v = t.values;
      if (v.refundRate !== undefined && v.gmv !== undefined) v.refund ??= v.refundRate * v.gmv;
      if (v.searchConversionRate !== undefined && v.searchUv !== undefined) {
        v.searchBuyers ??= Math.round(v.searchConversionRate * v.searchUv);
      }
      /**
       * 反过来也补一次：月汇总只给了利润的绝对值，没给利润率，
       * 而 9–12 月只有月汇总 —— 不补的话季度 / 全年口径下利润率整行是「—」，
       * 明明利润和 GMV 的目标都在手上。除出来的和表里已有的月份一致（差 <0.1pp）。
       */
      if (v.grossProfit !== undefined && v.gmv) v.profitRate ??= v.grossProfit / v.gmv;
      if (v.adCost !== undefined && v.gmv) v.adCostRate ??= v.adCost / v.gmv;
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
    monthlyActuals,
    excludedProductGmv,
    adTotals: adTotals.sort((a, b) => (a.date === b.date ? a.scope.localeCompare(b.scope) : a.date < b.date ? -1 : 1)),
    // 搜索词长表由 sync 单独接进来（在另一份工作簿里）
    searchTerms: [],
    warnings,
  };
}
