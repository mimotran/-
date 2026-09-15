/**
 * 「排查记录」快照落盘。
 *
 * 构建静态页时优先现拉飞书；拉不到（本地没配凭证、CI 上临时不可用）就退回这份快照。
 * 和天猫看板一样的取舍：宁可发一份旧但真的数据，也不发编出来的。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { LinkSnapshot } from './types';

export function snapshotPath(): string {
  const dir = process.env.SNAPSHOT_DIR?.trim() || join(process.cwd(), 'data', 'snapshots');
  return resolve(dir, 'links.json');
}

export async function readLinkSnapshot(): Promise<LinkSnapshot | null> {
  try {
    const parsed = JSON.parse(await readFile(snapshotPath(), 'utf8')) as LinkSnapshot;
    // 空快照当没有 —— 让调用方走「不替换页面里已有数据」的分支
    if (!Array.isArray(parsed.rows) || parsed.rows.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeLinkSnapshot(snapshot: LinkSnapshot): Promise<boolean> {
  const path = snapshotPath();
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(snapshot), 'utf8');
    return true;
  } catch (err) {
    console.warn('[snapshot] 写入失败，本次同步结果不会持久化：', err);
    return false;
  }
}
