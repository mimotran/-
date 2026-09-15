/**
 * 生成「链接明细页」静态文件：`npm run build:links`
 *
 * 做两件事：
 *   1. 把 lib/lowprice/rules.js **原样**注入页面的 rules 块 —— 口径只有一份源码，
 *      Node 侧自检和页面上算的是同一段代码，不存在「两边走样」这回事。
 *   2. 把当前「排查记录」换进页面里的 `const DATA = {...}`。
 *
 * 取不到真实数据时**不替换** DATA，保留页面里已有的那份（仓库里那份是空的，
 * 页面会显示空态）。理由和天猫看板一样：编出来的数据摆在对外网址上看不出是假的。
 *
 * 用法：
 *   npm run build:links                         → dist/links.html
 *   npm run build:links -- out.html             → 指定产物路径
 *   npm run build:links -- --write-preview      → 同时把 rules 块写回 preview/links.html
 *   npm run build:links -- x.html --fixture f.json
 *       用一份本地造的数据渲染，**只能**输出到自定义路径，用于本地验证交互
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadFeishuConfig } from '../lib/feishu/config';
import { isLowPriceConfigured, syncLinks } from '../lib/lowprice/feishu';
import { latestDate } from '../lib/lowprice/rules.js';
import { readLinkSnapshot } from '../lib/lowprice/snapshot';
import type { LinkRecord, LinkSnapshot } from '../lib/lowprice/types';
import { loadLocalEnv } from './env';

loadLocalEnv();

const DATA_MARK = 'const DATA = ';
const RULES_BEGIN = '/* __RULES_BEGIN__ */';
const RULES_END = '/* __RULES_END__ */';

const PREVIEW = 'preview/links.html';
const DEFAULT_OUT = 'dist/links.html';

/** 把 rules.js 变成能直接塞进 <script> 的普通脚本：去掉 export，其余一字不改 */
function inlineRules(): string {
  const src = readFileSync(resolve(process.cwd(), 'lib/lowprice/rules.js'), 'utf8');
  if (/^\s*import\s/m.test(src)) {
    throw new Error('lib/lowprice/rules.js 里出现了 import —— 它必须是零依赖的纯 JS 才能注入页面');
  }
  return src.replace(/^export /gm, '');
}

function replaceRules(html: string, rules: string): string {
  const start = html.indexOf(RULES_BEGIN);
  const end = html.indexOf(RULES_END);
  if (start < 0 || end < 0) throw new Error(`${PREVIEW} 里找不到 rules 标记，页面结构变了`);
  return `${html.slice(0, start + RULES_BEGIN.length)}\n${rules}\n${html.slice(end)}`;
}

function replaceData(html: string, payload: unknown): string {
  const start = html.indexOf(DATA_MARK);
  if (start < 0) throw new Error(`${PREVIEW} 里找不到 "${DATA_MARK}"，页面结构变了`);
  const from = start + DATA_MARK.length;
  // DATA 压缩成一行 JSON，它后面第一个 "};" 就是结尾
  const end = html.indexOf('};', from);
  if (end < 0) throw new Error('找不到 DATA 的结尾，页面结构变了');
  return html.slice(0, from) + JSON.stringify(payload) + html.slice(end + 1);
}

/** 现拉飞书 → 本地快照 → 都没有 */
async function loadSnapshot(): Promise<LinkSnapshot | null> {
  if (isLowPriceConfigured()) {
    try {
      const fresh = await syncLinks(loadFeishuConfig());
      if (fresh.rows.length) {
        console.log(`· 已从飞书「${fresh.sheetTitle}」拉到 ${fresh.rows.length} 行`);
        return fresh;
      }
      console.warn('⚠ 飞书读到了表但没解析出记录，改用本地快照。');
    } catch (err) {
      console.warn('⚠ 飞书拉取失败，改用本地快照：', err instanceof Error ? err.message : err);
    }
  }
  const cached = await readLinkSnapshot();
  if (cached) console.log(`· 使用本地快照（${cached.rows.length} 行，同步于 ${cached.syncedAt}）`);
  return cached;
}

function buildPayload(snapshot: LinkSnapshot) {
  return {
    rows: snapshot.rows,
    source: snapshot.source,
    syncedAt: snapshot.syncedAt,
    docUrl: snapshot.docUrl,
    sheetTitle: snapshot.sheetTitle,
    warnings: snapshot.warnings,
    /** 页面右上角的「最近数据日期」取它；页面自己也能从 rows 现算，这里只是省一次遍历 */
    latestDate: latestDate(snapshot.rows),
    builtAt: new Date().toISOString(),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const writePreview = args.includes('--write-preview');
  const fixtureIndex = args.indexOf('--fixture');
  const fixture = fixtureIndex >= 0 ? args[fixtureIndex + 1] : '';
  const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--fixture');
  const out = resolve(process.cwd(), positional[0] ?? DEFAULT_OUT);

  if (fixture && !positional[0]) {
    throw new Error('--fixture 是本地验证用的假数据，必须显式指定产物路径，不能直接写进 dist/');
  }

  const src = resolve(process.cwd(), PREVIEW);
  const rules = inlineRules();
  let html = replaceRules(readFileSync(src, 'utf8'), rules);

  // rules 块写回 preview：让仓库里那份页面单独打开也是最新口径
  if (writePreview) {
    writeFileSync(src, html, 'utf8');
    console.log(`· 已把 rules 块写回 ${PREVIEW}`);
  }

  let snapshot: LinkSnapshot | null;
  if (fixture) {
    const rows = JSON.parse(readFileSync(resolve(process.cwd(), fixture), 'utf8')) as LinkRecord[];
    snapshot = {
      rows,
      source: 'none', // 页面据此打出「非真实数据」的横幅
      syncedAt: new Date().toISOString(),
      docUrl: '',
      sheetTitle: `本地样例数据（${fixture}）`,
      warnings: ['当前页面用的是本地样例数据，仅供界面验证，数字不作数。'],
    };
    console.log(`⚠ 使用本地样例数据 ${fixture}（${rows.length} 行），仅供界面验证`);
  } else {
    snapshot = await loadSnapshot();
  }

  const useFresh = snapshot !== null && snapshot.rows.length > 0;
  if (useFresh) html = replaceData(html, buildPayload(snapshot as LinkSnapshot));

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html, 'utf8');

  const kb = Math.round(html.length / 1024);
  if (useFresh) {
    const s = snapshot as LinkSnapshot;
    console.log(`✓ 生成 ${out}（${kb} KB，${s.rows.length} 行，最新 ${latestDate(s.rows)}）`);
    for (const warning of s.warnings) console.log(`  ⚠ ${warning}`);
  } else {
    console.log(`✓ 生成 ${out}（${kb} KB，沿用 ${PREVIEW} 里已有的数据）`);
    console.log('⚠ 没拿到「排查记录」，页面会显示空态 —— 不会把编出来的数据发到线上。');
    console.log('  配好 FEISHU_APP_ID / FEISHU_APP_SECRET（并把应用加进该表的协作者）后重跑。');
  }
}

main().catch((err) => {
  console.error('构建失败：', err instanceof Error ? err.message : err);
  process.exit(1);
});
