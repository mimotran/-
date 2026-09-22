/**
 * 把每周低价链接简报推到飞书群：`npm run send:digest [-- --send]`
 *
 * 默认只在终端打印内容，加 --send 才真的发出去 —— 发群是不可撤销的对外动作，
 * 别让一次手滑变成一条群消息。
 *
 * Webhook 从环境变量 FEISHU_DIGEST_WEBHOOK 读，不写进代码。
 * 谁拿到这个地址谁就能往群里发消息，所以它只该出现在 Actions secret 和本地 .env 里。
 */

import { writeFileSync } from 'node:fs';
import { buildDigestCard, describeDigest } from '../lib/lowprice/digest';
import { readLinkSnapshot } from '../lib/lowprice/snapshot';
import { loadLocalEnv } from './env';

loadLocalEnv();

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main() {
  const send = process.argv.includes('--send');
  const snapshot = await readLinkSnapshot();
  if (!snapshot || snapshot.rows.length === 0) {
    throw new Error('本地没有数据快照，先跑 npm run sync:links');
  }

  const pushDate = arg('date') ? new Date(`${arg('date')}T00:00:00Z`) : new Date();
  const card = buildDigestCard(snapshot.rows, { pushDate });

  console.log(describeDigest(snapshot.rows));
  console.log('');

  const dump = arg('dump');
  if (dump) {
    writeFileSync(dump, JSON.stringify(card, null, 2));
    console.log(`· 卡片 JSON 已写到 ${dump}`);
  }

  if (!send) {
    console.log('（未加 --send，没有发送）');
    return;
  }

  const hook = process.env.FEISHU_DIGEST_WEBHOOK;
  if (!hook) throw new Error('缺 FEISHU_DIGEST_WEBHOOK —— 群机器人的 webhook 地址');

  const res = await fetch(hook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg_type: 'interactive', card }),
  });
  const body = (await res.json()) as { code?: number; msg?: string };
  if (body.code !== 0) throw new Error(`飞书返回错误：${body.msg}（code ${body.code}）`);
  console.log('✓ 已推送到飞书群');
}

main().catch((err) => {
  console.error('');
  console.error('✗ 推送失败：', err instanceof Error ? err.message : err);
  process.exit(1);
});
