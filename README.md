# 天猫数据看板

数据源是**飞书文档**，每日自动同步。看板分四个板块：销售概览、流量与转化、商品分析、活动与营销。

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
| `drive:drive:readonly` | 查看云空间文件（上面几个的前置依赖） |

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
# 链接 https://xxx.feishu.cn/wiki/Dx6FwC0DnirSYxk8cHmcoDF6nwf?sheet=7ngPBd
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
✓ wiki 节点「天猫日报」→ sheet / shtcnXXXXXXXX
✓ 电子表格子表：
    日报        (sheet_id: 7ngPBd, 380 行)
    流量渠道     (sheet_id: k8Ld2m, 2660 行)
✓ 同步完成，来源 feishu-sheets
  覆盖 2025-08-01 ~ 2026-08-06
```

## 表结构

只有**日报表是必需的**，其余三张没配就对应板块降级为空态，不影响销售概览。

| 表 | 必需列 |
|---|---|
| 日报 | 日期、支付金额、支付订单数、支付买家数、访客数、浏览量、加购件数、收藏人数、退款金额、推广花费 |
| 流量渠道 | 日期、流量来源、访客数、支付金额、支付订单数 |
| 商品明细 | 日期、商品ID、商品名称、类目、支付金额、支付件数、访客数、库存 |
| 活动 | 活动名称、开始日期、结束日期、支付金额、支付订单数、访客数、活动投入、优惠券核销、活动类型 |

**列名不用完全一致。** 每个字段都配了一组别名，「支付金额」「成交金额」「GMV」都能识别。
你的表头对不上时，去 `lib/feishu/mapping.ts` 里给对应字段加一个别名即可，一个文件搞定。

解析原则是**坏行跳过、不是整表报错**：某天忘了填日期、加了一行备注、留了空行，
都只会在页面顶部记一条告警，不会让看板挂掉。

日期格式不挑：`2026-08-07`、`2026/8/7`、`20260807`、`8月7日`、多维表格的时间戳、
电子表格的序列号都能解析。数字也会自动吃掉千分位逗号、`¥`、`元`、`%`。

## 每日自动同步

同步接口是 `POST /api/sync`，用 `SYNC_TOKEN` 鉴权（没设就返回 503 直接关闭，
避免裸奔的端点被人拿去打爆飞书接口）。

```bash
SYNC_TOKEN=$(openssl rand -hex 32)   # 写进 .env.local
curl -X POST -H "Authorization: Bearer $SYNC_TOKEN" https://你的域名/api/sync
```

两种定时方式，任选：

**Vercel Cron** — `vercel.json` 里已配好，每天 UTC 01:30（北京时间 09:30）触发。
在 Vercel 项目里配好 `SYNC_TOKEN` 环境变量即可。

**GitHub Actions** — `.github/workflows/daily-sync.yml`，同样的时间。
在仓库 Settings → Secrets 里加 `DASHBOARD_URL` 和 `SYNC_TOKEN`。失败会退避重试三次。

同步结果落盘成 JSON 快照，飞书临时不可用时页面还能展示上一次的数据，
并在顶部标明「当前展示 X 月 X 日的存量数据」。
Vercel 等只读文件系统上把 `SNAPSHOT_DIR` 指到 `/tmp`。

## 数据一致性

```bash
npm run check
```

检查渠道、商品的分项之和是否等于当日大盘。
分项加起来对不上总数是最伤看板可信度的问题——运营核对时第一个发现的就是这个，
一旦对不上，之后所有数字都不会有人再信。

## 指标口径

- **环比**：对比紧邻当前区间之前、等长的一段
- **同比**：对比去年同期（往前推 365 天）
- **预设区间以「数据最后一天」为终点**，不是今天。天猫数据 T+1 出，用今天当终点会永远少一天
- **客单价** = 支付金额 ÷ 支付买家数
- **支付转化率** = 支付买家数 ÷ 访客数
- **售罄天数** = 期末库存 ÷ 区间日均销量
- **活动拉动倍数** = 活动期日均 GMV ÷ 活动前等长天数的日均 GMV
- **转化漏斗**只有访客 → 加购 → 支付买家三层。收藏是和加购平行的互动行为，
  串进漏斗会算出「加购到收藏留存 57%」这种没有含义的数字，所以它单独作为一个 KPI

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
  page.tsx               看板主页（服务端渲染，按 ?range= 切区间）
  api/sync/route.ts      同步端点
lib/
  types.ts               统一数据模型
  metrics.ts             指标计算：环比同比、漏斗、渠道、商品、活动
  format.ts              数字格式化（万/亿、精确值、变化率）
  feishu/
    client.ts            tenant_access_token + 重试
    wiki.ts              知识库节点 → obj_token
    sheets.ts            电子表格读取
    bitable.ts           多维表格读取
    mapping.ts           列名别名映射与类型解析  ← 表头对不上就改这里
    normalize.ts         原始行 → 数据模型
    sync.ts              完整同步流程
  data/
    source.ts            数据源解析：快照 → 飞书 → mock
    snapshot.ts          快照落盘
    mock.ts              演示数据（固定种子，结果可复现）
components/
  charts/                自绘 SVG 图表
  sections/              四大板块
  ui/                    KPI 卡片、筛选、表格视图
scripts/
  sync.ts                本地同步与连通性自检
  check-consistency.ts   分项与大盘的一致性检查
```

## 技术栈

Next.js 16（App Router）· React 19 · TypeScript · Tailwind CSS v4。

图表是自绘 SVG，没引图表库——需要精确控制堆叠段之间的 2px 缝隙、
数据端 4px 圆角、准星吸附这些细节，套库反而更费劲。
