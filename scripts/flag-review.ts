/**
 * 给「排查登记表」里需要人工核验的行标底色：`npm run flag:review [-- --date=YYYY-MM-DD]`
 *
 * 每次 import:search 之后跑一次。两档颜色，因为两类问题的紧迫程度不一样：
 *
 *   深黄 必须核验 —— 型号认不出（整行判不了低价，看板归入「缺口径」）
 *                     或低价幅度 ≥ 40%（几乎可以肯定是最低 SKU 价，不是整机价，
 *                     会把「严重低价」这个数顶上去）
 *   浅黄 顺带看一眼 —— 售价高于指导价 1.5 倍。不影响低价统计（这些是非低价行），
 *                     但价格本身可疑，多半是代购加价或者挂错 SKU
 *
 * 默认只标最新一个批次 —— 往期数据大多已经人工核过，重新刷一遍底色只会制造噪音。
 *
 * 核完之后 `--clear` 把底色刷回白底：`npm run flag:review -- --clear --all`
 *
 * **这个脚本默认会写底色。** 只想看看有哪些行可疑就加 `--dry` ——
 * 不加的话，一次「随手查一下」就会把刚清干净的表重新刷黄。
 */

import { feishuGet, feishuPut } from '../lib/feishu/client';
import { loadFeishuConfig, type FeishuConfig } from '../lib/feishu/config';
import { DEFAULT_SPREADSHEET_TOKEN, loadLowPriceSource } from '../lib/lowprice/feishu';
import { ABNORMAL_RATE } from '../lib/lowprice/rules.js';
import { loadLocalEnv } from './env';

loadLocalEnv();

const LOG_SHEET = '1WDztC';
const MUST_REVIEW = '#FFE08A'; // 深黄
const WORTH_A_LOOK = '#FFF5D1'; // 浅黄
const WHITE = '#FFFFFF';
/** 高于指导价多少倍算「价格离谱」 */
const OVERPRICED_MULTIPLE = 1.5;

const text = (cell: unknown): string =>
  Array.isArray(cell)
    ? cell.map((c) => (c as { text?: string }).text ?? '').join('')
    : cell == null
      ? ''
      : String(cell).trim();

const num = (cell: unknown): number | null => {
  const raw = text(cell).replace(/[^\d.\-]/g, '');
  return raw === '' ? null : Number(raw);
};

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

/** 连续行号合并成区间，少发几个 range */
function toRanges(rows: number[], lastColumn: string): string[] {
  const sorted = [...rows].sort((a, b) => a - b);
  const out: string[] = [];
  let start: number | null = null;
  let prev: number | null = null;
  const flush = () => {
    if (start === null || prev === null) return;
    out.push(`${LOG_SHEET}!A${start}:${lastColumn}${prev}`);
  };
  for (const r of sorted) {
    if (start === null) { start = prev = r; continue; }
    if (r === (prev as number) + 1) { prev = r; continue; }
    flush();
    start = prev = r;
  }
  flush();
  return out;
}

async function main() {
  const cfg: FeishuConfig = loadFeishuConfig();
  const token = loadLowPriceSource().spreadsheetToken || DEFAULT_SPREADSHEET_TOKEN;

  const data = await feishuGet<{ valueRange?: { values?: unknown[][] } }>(
    `/sheets/v2/spreadsheets/${token}/values/${encodeURIComponent(`${LOG_SHEET}!A1:Q20000`)}`,
    {},
    cfg,
  );
  const grid = data.valueRange?.values ?? [];
  const header = grid[0]?.map(text) ?? [];
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`表头里找不到「${name}」`);
    return i;
  };
  const lastColumn = String.fromCharCode(65 + header.length - 1);

  const dates = grid
    .slice(1)
    .map((r) => text(r[col('排查日期')]))
    .filter(Boolean)
    .sort();
  const target = arg('date') ?? dates[dates.length - 1];
  if (!target) throw new Error('表里没有可识别的排查日期');

  const clear = process.argv.includes('--clear');
  const dry = process.argv.includes('--dry');
  const batchRows: number[] = [];
  const must: number[] = [];
  const look: number[] = [];
  const detail: Array<[number, string, string]> = [];

  for (let i = 1; i < grid.length; i++) {
    const row = grid[i];
    if (text(row[col('排查日期')]) !== target) continue;
    const rowNo = i + 1;
    batchRows.push(rowNo);
    const shop = text(row[col('卖家昵称')]);
    const model = text(row[col('产品型号')]);
    const price = num(row[col('违规售价')]);
    const list = num(row[col('官方指导价')]);

    if (!model || !list) {
      must.push(rowNo);
      detail.push([rowNo, shop, '型号/指导价缺失，判不了低价']);
      continue;
    }
    if (price === null) continue;
    const rate = (list - price) / list;
    if (rate >= ABNORMAL_RATE) {
      must.push(rowNo);
      detail.push([rowNo, shop, `低价幅度 ${(rate * 100).toFixed(1)}%，疑似最低 SKU 价`]);
    } else if (price > list * OVERPRICED_MULTIPLE) {
      look.push(rowNo);
      detail.push([rowNo, shop, `售价 ¥${price} 是指导价 ¥${list} 的 ${(price / list).toFixed(1)} 倍`]);
    }
  }

  console.log(`· 批次 ${target}`);
  console.log(`  必须核验 ${must.length} 行，顺带看一眼 ${look.length} 行`);
  for (const [rowNo, shop, why] of detail.sort((a, b) => a[0] - b[0])) {
    console.log(`    第 ${String(rowNo).padStart(3)} 行  ${shop.padEnd(22)} ${why}`);
  }

  if (dry) {
    console.log('');
    console.log('（--dry：只看不写，表格底色没动）');
    return;
  }

  // --clear：把这批的底色刷回白底。刷的是「按当前规则会被标的行」，
  // 所以要在改数据**之前**清，或者干脆用 --all 把整批刷白 —— 数据改完之后
  // 规则命中的行会变少，只清命中的行会留下几格洗不掉的黄。
  if (clear) {
    const all = process.argv.includes('--all');
    const rows = all ? batchRows : [...must, ...look];
    if (rows.length === 0) { console.log('  没有要清的行。'); return; }
    await feishuPut(`/sheets/v2/spreadsheets/${token}/styles_batch_update`, {
      data: [{ ranges: toRanges(rows, lastColumn), style: { backColor: WHITE } }],
    }, cfg);
    console.log('');
    console.log(`✓ 已把 ${rows.length} 行刷回白底${all ? '（--all：整批）' : ''}`);
    return;
  }

  const payload = [
    { ranges: toRanges(must, lastColumn), style: { backColor: MUST_REVIEW } },
    { ranges: toRanges(look, lastColumn), style: { backColor: WORTH_A_LOOK } },
  ].filter((d) => d.ranges.length > 0);

  if (payload.length === 0) {
    console.log('  没有需要标记的行。');
    return;
  }
  await feishuPut(`/sheets/v2/spreadsheets/${token}/styles_batch_update`, { data: payload }, cfg);
  console.log('');
  console.log(`✓ 已标色（深黄 ${MUST_REVIEW} / 浅黄 ${WORTH_A_LOOK}）`);
}

main().catch((err) => {
  console.error('');
  console.error('✗ 标记失败：', err instanceof Error ? err.message : err);
  process.exit(1);
});
