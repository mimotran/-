/**
 * 给「排查登记表」里需要人工核验的行标底色：`npm run flag:review [-- --date=YYYY-MM-DD]`
 *
 * 每次 import:search 之后跑一次。只标一种颜色（深黄 = 必须核验）：
 *
 *   深黄 必须核验 —— 售价低于 ¥1000，或型号认不出（整行判不了低价，看板归入「缺口径」），
 *                     或搜索页价低于 ¥1000、导入时已按往期人工核定价替换的（备注里有「需二次确认」）。
 *                     ¥999 是最低一档指导价，售价比它还低的不是最低 SKU 价就是配件价，
 *                     不核就会把「严重低价」顶上去。最早的规则是「低价幅度 ≥ 40%」，
 *                     但 ¥799 / ¥800 这种 38% 的卡在线下面漏过去好几期 —— 按产品方
 *                     的口径改成了价格线。
 *
 * 型号是沿用往期 / 按关键词推断填进去的行不标 —— 产品方看过一轮觉得没必要
 * （推断错了改个型号就行，不影响别的格子），备注里写着来源，要查随时能查。
 *
 * 售价远高于指导价的代购加价行不再标：产品方确认过这些价格不用改，每周标一遍只是噪音。
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
import { loadLocalEnv } from './env';

loadLocalEnv();

const LOG_SHEET = '1WDztC';
const MUST_REVIEW = '#FFE08A'; // 深黄
const WHITE = '#FFFFFF';
/** 售价低于这个数就要二次确认（产品方定的线，¥999 是最低一档指导价） */
const PRICE_FLOOR = 1000;

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
    const note = text(row[col('备注')]);

    if (!model || !list) {
      must.push(rowNo);
      detail.push([rowNo, shop, '型号/指导价缺失，判不了低价']);
      continue;
    }
    const replaced = note.match(/搜索页显示 ¥([\d.]+)（低于 ¥1000），已按 (\S+) 批次人工核定售价 ¥([\d.]+) 填入/);
    if (replaced) {
      must.push(rowNo);
      detail.push([rowNo, shop, `搜索页 ¥${replaced[1]}，已按 ${replaced[2]} 核定价 ¥${replaced[3]} 填入，需二次确认`]);
      continue;
    }
    if (price !== null && price < PRICE_FLOOR) {
      must.push(rowNo);
      const hint = note.match(/该链接 \S+ 批次人工核定售价 ¥[\d.]+/);
      detail.push([rowNo, shop, `售价 ¥${price} 低于 ¥${PRICE_FLOOR}，需二次确认${hint ? `（${hint[0]}）` : ''}`]);
      continue;
    }
  }

  console.log(`· 批次 ${target}`);
  console.log(`  必须核验 ${must.length} 行`);
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
    const rows = all ? batchRows : must;
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
  ].filter((d) => d.ranges.length > 0);

  if (payload.length === 0) {
    console.log('  没有需要标记的行。');
    return;
  }
  await feishuPut(`/sheets/v2/spreadsheets/${token}/styles_batch_update`, { data: payload }, cfg);
  console.log('');
  console.log(`✓ 已标深黄 ${MUST_REVIEW}`);
}

main().catch((err) => {
  console.error('');
  console.error('✗ 标记失败：', err instanceof Error ? err.message : err);
  process.exit(1);
});
