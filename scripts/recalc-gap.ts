/**
 * 按「违规售价」和「官方指导价」重算整表的价差与低价幅度：`npm run recalc:gap [-- --write]`
 *
 * 人工核验改过售价或补过型号之后跑一次。三件事：
 *   1. 官方指导价为空的，按 产品型号 + 版本 从 LIST_PRICE 补上
 *   2. 价差(元) = 官方指导价 − 违规售价
 *   3. 低价幅度 = 价差 / 官方指导价
 *
 * **价格方向别搞反**：低价是「卖得比指导价便宜」，价差为正。卖得比指导价贵时
 * 价差是负的、幅度也是负的，这不是错，别顺手取绝对值。
 *
 * 低价幅度那一列是百分比格式的单元格 —— 接口读回来是小数（-2.174 显示成 -217.4%），
 * 写进去也要写小数。曾经有几行存着 -0.02174，显示 -2.17%，比真值小 100 倍。
 *
 * 默认只打印不写，确认无误再加 --write。
 */

import { feishuGet, feishuPut } from '../lib/feishu/client';
import { loadFeishuConfig, type FeishuConfig } from '../lib/feishu/config';
import { LIST_PRICE } from '../lib/lowprice/import/classify';
import { DEFAULT_SPREADSHEET_TOKEN, loadLowPriceSource } from '../lib/lowprice/feishu';
import { loadLocalEnv } from './env';

loadLocalEnv();

const LOG_SHEET = '1WDztC';

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

const colLetter = (i: number) => String.fromCharCode(65 + i);

interface Edit {
  row: number;
  shop: string;
  listPrice?: { from: string; to: number };
  gap?: { from: string; to: number };
  rate?: { from: string; to: number };
}

async function main() {
  const write = process.argv.includes('--write');
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
  const [cShop, cModel, cVersion, cPrice, cList, cGap, cRate] = [
    '卖家昵称', '产品型号', '版本', '违规售价', '官方指导价', '价差(元)', '低价幅度',
  ].map(col);

  const edits: Edit[] = [];
  const blocked: string[] = [];

  for (let i = 1; i < grid.length; i++) {
    const row = grid[i];
    const rowNo = i + 1;
    const shop = text(row[cShop]);
    if (!shop) continue;

    const price = num(row[cPrice]);
    if (price === null) { blocked.push(`第 ${rowNo} 行 ${shop}：没有违规售价，跳过`); continue; }

    let list = num(row[cList]);
    const edit: Edit = { row: rowNo, shop };

    if (list === null) {
      const model = text(row[cModel]);
      const version = text(row[cVersion]) as '国内版' | '海外版';
      const table = LIST_PRICE[model];
      if (!table) { blocked.push(`第 ${rowNo} 行 ${shop}：型号「${model || '空'}」不在指导价表里，补不了`); continue; }
      if (version !== '国内版' && version !== '海外版') {
        blocked.push(`第 ${rowNo} 行 ${shop}：版本「${version || '空'}」既不是国内版也不是海外版，补不了指导价`);
        continue;
      }
      list = table[version];
      edit.listPrice = { from: '空', to: list };
    }

    const gap = Number((list - price).toFixed(2));
    const rate = Number(((list - price) / list).toFixed(6));
    const curGap = num(row[cGap]);
    const curRate = num(row[cRate]);
    if (curGap === null || Math.abs(curGap - gap) > 0.01) edit.gap = { from: text(row[cGap]) || '空', to: gap };
    if (curRate === null || Math.abs(curRate - rate) > 1e-5) edit.rate = { from: text(row[cRate]) || '空', to: rate };

    if (edit.listPrice || edit.gap || edit.rate) edits.push(edit);
  }

  if (blocked.length) {
    console.log(`⚠ ${blocked.length} 行处理不了，需要人工补：`);
    for (const b of blocked) console.log(`    ${b}`);
    console.log('');
  }

  if (edits.length === 0) {
    console.log('✓ 全表的价差 / 低价幅度都和售价对得上，没有要改的。');
    return;
  }

  console.log(`${edits.length} 行要改：`);
  for (const e of edits) {
    const parts = [
      e.listPrice && `指导价 ${e.listPrice.from} → ${e.listPrice.to}`,
      e.gap && `价差 ${e.gap.from} → ${e.gap.to}`,
      e.rate && `幅度 ${e.rate.from} → ${(e.rate.to * 100).toFixed(2)}%`,
    ].filter(Boolean);
    console.log(`    第 ${String(e.row).padStart(3)} 行 ${e.shop.padEnd(22)} ${parts.join('，')}`);
  }

  if (!write) {
    console.log('');
    console.log('（未加 --write，没有写入）');
    return;
  }

  // 指导价和价差/幅度不相邻，分两组写；同一行的相邻两列合成一次请求
  for (const e of edits) {
    if (e.listPrice) {
      await feishuPut(`/sheets/v2/spreadsheets/${token}/values`, {
        // 单格也要写成 A1:A1 的形式，飞书不认单边的 A1（会回 code 90202 wrong range）
        valueRange: { range: `${LOG_SHEET}!${colLetter(cList)}${e.row}:${colLetter(cList)}${e.row}`, values: [[e.listPrice.to]] },
      }, cfg);
    }
    if (e.gap || e.rate) {
      const row = grid[e.row - 1];
      const gap = e.gap ? e.gap.to : num(row[cGap]);
      const rate = e.rate ? e.rate.to : num(row[cRate]);
      await feishuPut(`/sheets/v2/spreadsheets/${token}/values`, {
        valueRange: { range: `${LOG_SHEET}!${colLetter(cGap)}${e.row}:${colLetter(cRate)}${e.row}`, values: [[gap, rate]] },
      }, cfg);
    }
  }
  console.log('');
  console.log(`✓ 写入完成。接下来跑 npm run sync:links 刷新看板。`);
}

main().catch((err) => {
  console.error('');
  console.error('✗ 重算失败：', err instanceof Error ? err.message : err);
  process.exit(1);
});
