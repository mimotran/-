import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { writeSnapshot } from '@/lib/data/snapshot';
import { isFeishuConfigured } from '@/lib/feishu/config';
import { syncFromFeishu } from '@/lib/feishu/sync';

export const dynamic = 'force-dynamic';
// 大表拉取 + 解析可能要几十秒，别用默认的 10s
export const maxDuration = 60;

/**
 * 手动 / 定时触发同步。
 *
 * 鉴权：Authorization: Bearer <SYNC_TOKEN>，或 ?token=<SYNC_TOKEN>（方便 cron 服务直接配 URL）。
 * 没设 SYNC_TOKEN 时接口直接关闭 —— 裸奔的同步端点等于给了任何人打爆飞书接口的开关。
 */
export async function POST(request: Request) {
  return handle(request);
}

/** Vercel Cron 只会发 GET，所以两个方法都收 */
export async function GET(request: Request) {
  return handle(request);
}

async function handle(request: Request): Promise<NextResponse> {
  const expected = process.env.SYNC_TOKEN?.trim();
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: '未设置 SYNC_TOKEN，同步接口已禁用' },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const provided =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ??
    url.searchParams.get('token')?.trim() ??
    '';

  if (!timingSafeEqual(provided, expected)) {
    return NextResponse.json({ ok: false, error: '鉴权失败' }, { status: 401 });
  }

  if (!isFeishuConfigured()) {
    return NextResponse.json(
      { ok: false, error: '飞书数据源未配置，请检查 FEISHU_APP_ID / FEISHU_APP_SECRET 及文档 token' },
      { status: 400 },
    );
  }

  try {
    const snapshot = await syncFromFeishu();
    const persisted = await writeSnapshot(snapshot);
    revalidatePath('/');

    return NextResponse.json({
      ok: true,
      source: snapshot.source,
      syncedAt: snapshot.syncedAt,
      coverage: snapshot.coverage,
      counts: {
        daily: snapshot.daily.length,
        ads: snapshot.ads.length,
        products: snapshot.products.length,
        keywords: snapshot.keywords.length,
        targets: snapshot.targets.length,
      },
      persisted,
      warnings: snapshot.warnings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

/** 定时比较，避免用返回快慢猜 token */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
