# 天猫数据看板

数据源是**飞书文档**，每日自动同步。看板分六个板块：目标达成、店铺整体、站内投放、站外投放、产品、流量。

每个板块的数字都按三档周期同时展示 —— **昨日**（环比前日）、**本月 MTD**（环比上月同期）、
**全年累计**（环比去年同期），另可指定任意自定义区间。

没配飞书凭证时会自动用演示数据跑起来，页面顶部会明确标出「演示数据」——
拿 mock 去开经营会是要出事的，所以这个提示不做成可关闭的。

## 快速开始

```bash
npm install
npm run dev        # http://localhost:3000
```

此时看到的是演示数据。接真实数据看下一节。

## 接飞书数据源

### 1. 建一个飞书自建应用

[open.feishu.cn/app](https://open.feishu.cn/app) → 创建企业自建应用。

「权限管理」里开通这几个**只读**权限：

| 权限码 | 说明 |
|---|---|
| `wiki:wiki:readonly` | 查看知识库（数据表挂在知识库里就必须开） |
| `sheets:spreadsheet:readonly` | 查看电子表格 |
| `bitable:app:readonly` | 查看多维表格（用多维表格时才需要） |
| `drive:drive:readonly` | 读表格数据走的是 sheets v2 接口，它的权限报错只说 "No permission"、不说缺什么，开上当保险 |

然后「版本管理与发布」→ 创建版本 → 申请发布。**必须发布**，否则下一步搜不到这个应用。

### 2. 把应用加进文档

这步最容易漏：权限开了但没加协作者，接口一律返回 `permission denied`。

- **整个知识库**：知识库名称右边「···」→ 知识库设置 → 成员管理 → 添加 → 搜应用名 → 可阅读
- **只给单篇**：文档右上角「···」→ 添加文档应用 → 搜应用名

### 3. 填环境变量

```bash
cp .env.example .env.local
```

最少填三项：

```bash
FEISHU_APP_ID=cli_xxxxxxxx
FEISHU_APP_SECRET=xxxxxxxx
# 链接 https://xxx.feishu.cn/wiki/Dx6FwC0DnirSYxk8cHmcoDF6nwf?sheet=awpfUO
# 里 /wiki/ 后面那一段
FEISHU_WIKI_TOKEN=Dx6FwC0DnirSYxk8cHmcoDF6nwf
```

文档类型（电子表格 / 多维表格）会自动识别，不用再指定。
不在知识库里的独立文档，改用 `FEISHU_SPREADSHEET_TOKEN` 或 `FEISHU_BITABLE_APP_TOKEN`，
详见 `.env.example`。

### 4. 验证连通性

```bash
npm run sync
```

这个脚本会把每一步的结果打出来——拿 token、解析 wiki 节点、列出所有子表及其 `sheet_id`、
读数据、解析字段。照着输出把 `FEISHU_SHEET_DAILY` 等填上即可：

```
✓ wiki 节点「Y26 Plaud天猫渠道日报」→ sheet / shtcnXXXXXXXX
✓ 电子表格子表：
    2.整体      (sheet_id: awpfUO, 380 行)
    3.投放-站内  (sheet_id: k8Ld2m, 2660 行)
✓ 同步完成，来源 feishu-sheets
  覆盖 2025-08-01 ~ 2026-08-06
```

### 5. 对齐表头

```bash
npm run headers
```

打印每张表的**真实列名**，并逐字段报告 `lib/feishu/mapping.ts` 的别名有没有命中：

```
   真实表头（15 列，380 行数据）：
     日期 | GMV | 主机销量 | 退后GMV | UV | 支付人数 | 客退率 | 投放费 | ... | 新客率
   字段映射：
     ✓ gmv                ← 「GMV」
     ✓ deviceSales        ← 「主机销量」
     ✗ searchUv           ← 没有列命中
   表里还有没被用到的列：店铺活动、备注
```

改别名之前先跑这个，别照着猜。**没命中的字段不会报错**——`pick` 返回 undefined、
`toNumber` 兜底成 0，同步照常成功，看板上只是多了一列 0。这种错最难发现，
所以对齐要靠这个显式检查，而不是等看板上的数字看起来不对。

### 排查

| 报错 | 原因 |
|---|---|
| `Host not in allowlist` / `返回的不是 JSON（HTTP 403）` | 运行环境的出站白名单没放行 `open.feishu.cn`。本机一般不会遇到，CI 和受限容器里常见 |
| `Access denied ... scopes is required`（code 99991672） | 应用**没开**对应只读权限。开放平台「权限管理」勾选后必须「创建版本并发布」。注意这和下面的 `permission denied` 是两回事：加协作者解决不了它 |
| `permission denied`（code 131006） | 权限开了，但应用没被加进知识库/文档协作者。注意这和上面的 99991672 是两回事 |
| `无法解析 wiki 节点` | 同上，或者 wiki token 抄错了 |
| `找不到子表「xxx」` | 报错里会列出所有可用子表及其 `sheet_id`，照着填 |
| `日报表没有解析出任何有效数据` | 表头对不上，去 `lib/feishu/mapping.ts` 加别名 |

## 表结构

只有**日报表是必需的**，其余五张没配就对应板块降级为空态。

| 表 | 环境变量 | 关键列 |
|---|---|---|
| 日报 | `FEISHU_SHEET_DAILY` | 日期、GMV、主机销量、退后GMV、退款金额、UV、搜索UV、支付人数、加购人数、投放费、站内消耗 |
| 站内投放 | `FEISHU_SHEET_ADS_INSITE` | 日期、触点、投放费、成交金额（或 ROI）、曝光量、点击量 |
| 站外投放 | `FEISHU_SHEET_ADS_OFFSITE` | 日期、渠道、投放费、成交金额（或 ROI）、曝光量、点击量 |
| 商品明细 | `FEISHU_SHEET_PRODUCTS` | 日期、商品ID、商品名称、GMV、销量、UV、退款金额 |
| 搜索关键词 | `FEISHU_SHEET_KEYWORDS` | 日期、关键词、搜索UV、成交金额、订单数 |
| 目标 | `FEISHU_SHEET_TARGETS` | 月份（`2026-08` 或「8月」，年度写 `2026`）、GMV目标、销量目标 |

**比率列可以代替绝对值列。** 表里只有「客退率」没有「退款金额」时，会用它乘 GMV 反推；
「站内ROI」乘「站内消耗」得到站内成交；「投放费 − 站内消耗」得到站外消耗。
模型里存的始终是可加的绝对值，比率一律聚合之后再算。

**列名不用完全一致。** 每个字段都配了一组别名，「GMV」「支付金额」「成交金额」都能识别。
表头归一化会吃掉空格、全角括号和 `(元)` `(台)` 这类单位后缀，所以「支付金额（元）」也能命中。
对不上时先跑 `npm run headers` 看哪个字段没命中，再去 `lib/feishu/mapping.ts` 给它加一个别名，
一个文件搞定。

解析原则是**坏行跳过、不是整表报错**：汇总行、分节标题行、空行都会被跳过并记一条告警，
不会让看板挂掉。

日期格式不挑：`2026-08-07`、`2026/8/7`、`20260807`、`8月7日`、多维表格的时间戳、
电子表格的序列号都能解析。不带年份的「7月1日」按当前年份补齐。
数字也会自动吃掉千分位逗号、`¥`、`元`、`%`。

## 每日自动同步

同步接口是 `POST /api/sync`，用 `SYNC_TOKEN` 鉴权（没设就返回 503 直接关闭，
避免裸奔的端点被人拿去打爆飞书接口）。

```bash
SYNC_TOKEN=$(openssl rand -hex 32)   # 写进 .env.local
curl -X POST -H "Authorization: Bearer $SYNC_TOKEN" https://你的域名/api/sync
```

两种定时方式，任选：

**Vercel Cron** — `vercel.json` 里已配好，每天 UTC 01:30（北京时间 09:30）触发。
只在部署到 Vercel 时生效；走 GitHub Pages 的话看下面那节，时间是**北京时间 10:30**。

## 对外发布（GitHub Pages）

看板本体 `preview/dashboard.html` 是自包含的单文件应用，数据以 `const DATA = {…}`
内联在里面，不依赖任何后端。`npm run build:static` 会把里面的数据换成当前数据源
导出的结果，产物写到 `dist/index.html`，可以丢给任何静态托管。

仓库里已配好 `.github/workflows/pages.yml`：改动看板会发一次、每天北京时间 10:30
重新拉一次数、也可以手动触发。**开启只需要一步** —— 仓库 Settings → Pages →
Source 选 **GitHub Actions**。地址是 `https://<用户名>.github.io/<仓库名>/`。

要让线上数据每天自己更新，把本地 `.env.local` 里那几个飞书变量加成仓库的
Actions secrets（Settings → Secrets and variables → Actions）：
`FEISHU_APP_ID` / `FEISHU_APP_SECRET` / `FEISHU_BASE_URL` / `FEISHU_WIKI_TOKEN` /
`FEISHU_WIKI_TOKEN_KEYWORDS` / `FEISHU_SHEET_*`。没配也能发布，只是数据停在
仓库里那份 `preview/dashboard.html` 的时点。

> **Pages 没有密码。** 拿到地址的人都能看到全量 GMV、投放费、利润和搜索词。
> 需要控制范围就别用 Pages，改用带访问控制的托管（例如 Vercel 的
> Deployment Protection），或者只把 `dist/index.html` 发给指定的人。
在 Vercel 项目里配好 `SYNC_TOKEN` 环境变量即可。

同步结果落盘成 JSON 快照，飞书临时不可用时页面还能展示上一次的数据，
并在顶部标明「当前展示 X 月 X 日的存量数据」。
Vercel 等只读文件系统上把 `SNAPSHOT_DIR` 指到 `/tmp`。

## 数据一致性

```bash
npm run check
```

检查商品 GMV、投放消耗、关键词搜索 UV 的分项之和是否等于当日大盘。
分项加起来对不上总数是最伤看板可信度的问题——运营核对时第一个发现的就是这个，
一旦对不上，之后所有数字都不会有人再信。

## 指标口径

数字对不上时先看这里。

- **昨日** 比前一天。天猫 T+1 出数，所以「昨日」就是数据的最后一天，不是日历上的昨天
- **本月 MTD** 比**上月同期**（1 号到同一个日号），不是整个上月。拿 7 天去比 31 天，
  每个月的前三周都会看起来在暴跌
- **全年累计** 比去年同期（1 月 1 日到去年的同一天）。去年没数据时显示「无数据」，不显示 0%
- **自定义区间** 比紧邻的等长区间
- **所有比率先汇总再相除**。先算每日退款率再取平均是错的 —— 那等于给成交 3 万和 300 万的
  日子同样的权重
- **计划进度**（目标达成里的竖线）按月度目标的分布加权，不是按日历天数。下半年的量有很大
  一块压在双 11 上，按天数算会把一个正常的 8 月判成「落后」
- **拆解板块**（投放 / 产品 / 流量）默认按本月 MTD 口径，不是昨日 —— 一天的样本太小，
  排出来的触点榜每天都在抖
- 客单价 = GMV ÷ 支付人数；UV 价值 = GMV ÷ UV；ROI = 投放成交 ÷ 投放费
- 主机销量只算录音笔本体（Pro / NotePin / NOTE），不含会员和配件

## 图表约定

配色和图表形态按数据可视化规范做，几条硬约束：

- **绝不用双轴**。两个量纲不同的指标（比如 GMV 和 ROI）不塞进一张图，
  两条轴的对齐方式是任意的，会凭空造出并不存在的相关性
- **分类色按固定顺序分配，永不循环**。超过 6 个渠道就并入「其他」，不生成新色相
- **名义类目统一用一个颜色**。按大小上色阶等于把长度这个已经在图上的信息又编码一遍
- **每张图都有数据表孪生体**。tooltip 只能增强不能垄断读数，键盘和读屏用户得有地方拿到同样的数字
- **深色模式是另选的一组色阶**，不是浅色的自动反转；两套都过了色弱（CVD）和对比度校验
- 状态色（健康/需补货/断货风险）永远配图标和文案，颜色从不单独承担含义

## 目录结构

```
app/                     页面与 API 路由
  page.tsx               看板主页（服务端渲染，?from=&to= 指定自定义区间）
  api/sync/route.ts      同步端点
lib/
  types.ts               统一数据模型
  dates.ts               日期工具（全部按 UTC，避免时区串数）
  metrics.ts             周期对比、聚合、目标达成、各维度拆解
  format.ts              数字格式化（万/亿、精确值、变化率）
  feishu/
    client.ts            tenant_access_token + 重试
    wiki.ts              知识库节点 → obj_token
    sheets.ts            电子表格读取
    bitable.ts           多维表格读取
    mapping.ts           列名别名映射与类型解析  ← 表头对不上就改这里（先跑 npm run headers）
    normalize.ts         原始行 → 数据模型（比率反推绝对值也在这里）
    sync.ts              完整同步流程
  data/
    source.ts            数据源解析：快照 → 飞书 → mock
    snapshot.ts          快照落盘
    mock.ts              演示数据（固定种子，结果可复现）
components/
  charts/                自绘 SVG 图表 + 可切换指标的趋势面板
  sections/              六大板块
  ui/                    KPI 卡片、目标达成条、周期分组、表格视图
scripts/
  sync.ts                本地同步与连通性自检
  headers.ts             真实表头 → 字段映射的对齐报告
  check-consistency.ts   分项与大盘的一致性检查
  env.ts                 .env.local 加载
```

## 技术栈

Next.js 16（App Router）· React 19 · TypeScript · Tailwind CSS v4。

图表是自绘 SVG，没引图表库——需要精确控制堆叠段之间的 2px 缝隙、
数据端 4px 圆角、准星吸附这些细节，套库反而更费劲。

## 静态预览页

```bash
npm run export preview/view.json   # 导出当前数据
```

`preview/dashboard.html` 是一份**自包含的单文件预览**（内联数据 + 内联 JS，不依赖任何外部资源），
双击就能在浏览器里打开，用于给不方便跑 Node 的人看版式。

它和 Next 应用共用 `lib/metrics.ts` 的指标逻辑（数据由 `npm run export` 导出），
所以两边数字不会对不上。但它是**某一时刻的快照**，不会自动更新 —— 真实使用请跑 Next 应用。
