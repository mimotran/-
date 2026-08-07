import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { DashboardSnapshot } from '@/lib/types';

/**
 * 快照落盘。
 *
 * 看板每天只同步一次，把结果存成 JSON 比每次渲染都打飞书接口划算得多，
 * 也让飞书临时不可用时页面还能展示昨天的数据。
 *
 * Vercel 等只读文件系统上写不进项目目录，把 SNAPSHOT_DIR 指到 /tmp 即可；
 * 写失败不抛错，只是下次访问要重新拉一遍。
 */

function snapshotPath(): string {
  const dir = process.env.SNAPSHOT_DIR?.trim() || join(process.cwd(), 'data', 'snapshots');
  return resolve(dir, 'latest.json');
}

export async function readSnapshot(): Promise<DashboardSnapshot | null> {
  try {
    const raw = await readFile(snapshotPath(), 'utf8');
    const parsed = JSON.parse(raw) as DashboardSnapshot;
    // 简单校验，防止半截写入的文件把页面搞崩
    if (!Array.isArray(parsed.daily) || parsed.daily.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeSnapshot(snapshot: DashboardSnapshot): Promise<boolean> {
  const path = snapshotPath();
  try {
    await mkdir(dirname(path), { recursive: true });
    // 先写临时文件再改名，避免读到写了一半的 JSON
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(snapshot), 'utf8');
    await writeFile(path, await readFile(tmp, 'utf8'), 'utf8');
    return true;
  } catch (err) {
    console.warn('[snapshot] 写入失败，本次同步结果不会持久化：', err);
    return false;
  }
}

/** 快照是否已经是今天（本地时区）同步的 */
export function isFresh(snapshot: DashboardSnapshot, now = new Date()): boolean {
  const synced = new Date(snapshot.syncedAt);
  if (Number.isNaN(synced.getTime())) return false;
  return synced.toDateString() === now.toDateString();
}
