import { loadFeishuConfig, type FeishuConfig } from './config';

/**
 * 飞书开放平台最小客户端：只做两件事 —— 拿 tenant_access_token、发带鉴权的请求。
 * token 有效期 2 小时，这里在进程内缓存并提前 5 分钟过期。
 */

interface FeishuEnvelope<T> {
  code: number;
  msg: string;
  data: T;
}

let tokenCache: { token: string; expiresAt: number } | null = null;

/** 单测/同步脚本重复调用时清空缓存 */
export function resetTokenCache(): void {
  tokenCache = null;
}

export class FeishuError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = 'FeishuError';
  }
}

async function fetchWithRetry(url: string, init: RequestInit, retries = 3): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init);
      // 429/5xx 值得重试，4xx 是调用方问题，直接抛
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          await sleep(2 ** attempt * 1000);
          continue;
        }
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < retries) await sleep(2 ** attempt * 1000);
    }
  }
  throw new FeishuError(`请求飞书接口失败：${String(lastError)}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 安全地把响应体当 JSON 解析。
 *
 * 直接 res.json() 在出问题时会抛出「Unexpected token 'H'」这种毫无指向性的错误 ——
 * 而真正的原因往往是中间有代理/网关，返回的是 HTML 错误页或纯文本，
 * 根本没到飞书。把原始响应带进报错里，排查时能少走很多弯路。
 */
async function parseJson<T>(res: Response, context: string): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    const preview = text.replace(/\s+/g, ' ').slice(0, 200);
    throw new FeishuError(
      `${context} 返回的不是 JSON（HTTP ${res.status}）。` +
        `多半是网络中间有代理或防火墙拦截，请求没到飞书。响应开头：${preview || '(空)'}`,
    );
  }
}

export async function getTenantAccessToken(cfg: FeishuConfig = loadFeishuConfig()): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now) return tokenCache.token;

  const res = await fetchWithRetry(`${cfg.baseUrl}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: cfg.appId, app_secret: cfg.appSecret }),
    cache: 'no-store',
  });

  const body = await parseJson<{
    code: number;
    msg: string;
    tenant_access_token?: string;
    expire?: number;
  }>(res, '获取 tenant_access_token');

  if (body.code !== 0 || !body.tenant_access_token) {
    throw new FeishuError(`获取 tenant_access_token 失败：${body.msg}（code ${body.code}）`, body.code);
  }

  const ttl = (body.expire ?? 7200) * 1000;
  tokenCache = { token: body.tenant_access_token, expiresAt: now + ttl - 5 * 60 * 1000 };
  return tokenCache.token;
}

/** 发起一次带 tenant token 的 GET，返回 data 字段 */
export async function feishuGet<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  cfg: FeishuConfig = loadFeishuConfig(),
): Promise<T> {
  const token = await getTenantAccessToken(cfg);
  const url = new URL(`${cfg.baseUrl}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }

  const res = await fetchWithRetry(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  const body = await parseJson<FeishuEnvelope<T>>(res, `飞书接口 ${path}`);
  if (body.code !== 0) {
    throw new FeishuError(`飞书接口 ${path} 返回错误：${body.msg}（code ${body.code}）`, body.code);
  }
  return body.data;
}
