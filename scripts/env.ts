import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 极简 .env 解析，避免为几个脚本引入 dotenv。
 * 已存在的环境变量优先，方便 CI 里直接用 secrets 覆盖。
 */
export function loadEnvFile(filename: string): void {
  try {
    const content = readFileSync(resolve(process.cwd(), filename), 'utf8');
    for (const line of content.split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const value = match[2].replace(/^["']|["']$/g, '');
      if (process.env[match[1]] === undefined) process.env[match[1]] = value;
    }
  } catch {
    // 文件不存在很正常，忽略
  }
}

/** 本地跑脚本时的惯例：.env.local 优先于 .env */
export function loadLocalEnv(): void {
  loadEnvFile('.env.local');
  loadEnvFile('.env');
}
