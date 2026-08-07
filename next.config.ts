import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // 看板数据每日更新一次，页面走 ISR，避免每次请求都打飞书接口
    staleTimes: { dynamic: 30, static: 300 },
  },
};

export default nextConfig;
