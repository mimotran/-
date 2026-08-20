---
name: tmall-dashboard
description: 天猫（Plaud）经营数据看板的改动指南 —— 数据源是飞书表格，产物是一个自包含的单文件 HTML 看板。凡是涉及这个项目的任何改动都要用它：加/改 KPI 指标、改趋势图或环形图的画法、调统计口径（退款率、ROI、费比、达成率）、改飞书字段映射、目标达成表、搜索词排行、发布到 GitHub Pages、排查「数据没更新」「数字对不上源表」。用户提到「看板」「天猫」「Plaud」「飞书表格同步」「dashboard.html」「目标达成」「投放费」「GMV 趋势图」，或在这个仓库里干活时，即使没点名这个 skill 也要先读它 —— 项目里有若干条不成文的统计口径和验证流程，凭直觉改必然会踩。
---

# 天猫数据看板

## 一句话架构

飞书表格 → TypeScript 数据管线 → **把数据烤进 HTML** → 一个 600KB 的单文件看板。

```
飞书工作簿           lib/feishu/*.ts        lib/metrics.ts      scripts/payload.ts
（6 个页签）    →    解析成 DailyMetric  →   聚合/达成/拆解   →   拼成 DATA 对象
                                                                        ↓
                                              scripts/build-static.ts 把 DATA 塞进
                                              preview/dashboard.html → dist/index.html
```

**页面本身零外部请求**：数据以 `const DATA = {...}` 内联在 HTML 里。这不是偷懒，是这个看板能被任何静态托管接住、能离线打开、能直接发给别人的原因。代价是「数据每天更新」只能靠**每天重跑一次构建**，而不是页面自己去请求接口 —— 静态页没有后端可请求。

## 先看哪里

| 你要改的东西 | 去这个文件 |
|---|---|
| 看板的任何视觉 / 交互 / 图表 | `preview/dashboard.html`（唯一的前端文件，HTML+CSS+JS 全在里面） |
| KPI 卡有哪些指标、目标达成表有哪些行 | `lib/metrics.ts`（`STORE_CORE` / `STORE_EXTRA` / `GOAL_METRICS`） |
| 聚合算法（区间求和、比率怎么算） | `lib/metrics.ts` 的 `aggregateRange` |
| 飞书哪一列对应哪个字段 | `lib/feishu/workbook.ts` |
| 搜索词长表（另一个工作簿） | `lib/feishu/keywords.ts` |
| 导出给页面的数据形状 | `scripts/payload.ts` + `lib/types.ts` |
| 发布流程 / 定时构建 | `.github/workflows/pages.yml` |

改页面时注意：`preview/dashboard.html` 里那个巨大的 `const DATA = {...}` 是**构建产物**，不要手改，也不要试图读它。用编辑器搜索时它会淹没结果，加 `--glob` 或直接按行号定位。

## 五条不成文的规矩

这些是这个项目里反复踩出来的，违反了页面不会报错，只会**悄悄给出错误的数**。

**1. 比率一律先汇总再相除。** 退款率 = 区间退款总额 ÷ 区间 GMV，不是每天的退款率取平均。后者等于给成交 3 万和 300 万的日子同样的权重。所有 ROI、费比、转化率、占比都适用。跨区间合并率型目标时按分母加权（见 `targetsForRange` 的 `weightBy`）。

**2. 绝不用双轴。** 量纲不同的指标不塞进同一根真值轴 —— 两条轴怎么对齐是任意的，会凭空造出并不存在的相关性。需要把 GMV、销量、费率画在一张图里时，整张图换成**指数（首日=100）**，并在副标题里写明。判定逻辑在 `axisMode()`：同量纲且量级差 ≤25 倍才用绝对值共轴。

**3. 缺的目标不拿已有的凑。** 飞书目标表里，站内外拆分和流量的分项只排到当月。季度 / 全年口径下这些行显示「—」，而不是拿已排的几个月加个和当成全周期目标 —— 那样算出来的达成度会偏高（这个 bug 存在过，Q3 目标一度只有 7+8 月）。表下那句说明也要跟着更新。

**4. 演示数据绝不发到线上。** 没有飞书凭据时 `getSnapshot()` 会回落到 mock，而 mock 是照着真实量级编的（客单价 ~1300、退款率 ~29%），摆在公开网址上根本看不出是假的。`build-static.ts` 里 `source !== 'mock'` 那个判断是**默认路径而不是防御性代码**，别删。「旧但真」永远好过「新但编」。

**5. 改完必须跑对账。** 见下面的验证循环。页面里为了支持任意自定义区间，在浏览器里**重写了一份**聚合逻辑；重写就有走样的风险，所以有一套把两边摆在一起比的工具。

## 验证循环

按顺序跑，任何一步不过就别提交。

```bash
# 0. 语法（HTML 里的 JS 不会被 tsc 检查，改完必查）
node -e "const fs=require('fs');const h=fs.readFileSync('preview/dashboard.html','utf8');
  fs.writeFileSync('/tmp/s.js',[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1]);"
node --check /tmp/s.js

# 1. 类型
npx tsc --noEmit

# 2. 数值对账：lib 算一遍，浏览器里再算一遍，逐格比（1600+ 项）
npx tsx scripts/xcheck.ts > /tmp/ref.json        # lib 侧参照
cp preview/dashboard.html /tmp/preview.html      # xcmp 读同目录的 preview.html + ref.json
cd /tmp && node <skill>/scripts/xcmp.mjs         # 需要 playwright-core
```

改了口径导致数字**应该**变化时，先重新生成 `ref.json` 再比 —— 参照是从 lib 生成的，两边一起变才说明改对了；只改页面不改 lib（或反过来）会立刻被抓出来。

**3. 浏览器探针。** 交互（悬停、点击、下拉、区间切换）没有单元测试，靠 Playwright 起一个真页面去点。`scripts/probe-template.mjs` 是模板，照着改选择器和断言。原则是**断言具体的值**（`opacity=0.34`、`带心-柱心=0.1px`）而不是「元素存在」—— 前者能抓到 16px 的错位，后者抓不到。

**4. 截图自己看一眼。** 深浅两色都看。数值对不代表好看，好看不代表没错位。

## 常见任务

### 加一个 KPI 指标

1. `lib/metrics.ts` 的 `STORE_CORE`（首屏）或 `STORE_EXTRA`（折叠区）里加一项 `{ key, label, pick, format, higherIsBetter }`
2. 如果 `Aggregate` 里还没有这个字段，先在 `aggregateRange` 里算出来（比率记得规矩 1）
3. 如果要能画进趋势图，在页面的 `trendRange()` 里补上同名字段，并在 `STORE_CHARTS` 里加一行
4. `npm run sync && npm run build:static`，然后跑验证循环

`higherIsBetter` 决定涨跌的颜色 —— 颜色表达**好坏**，箭头表达**方向**，所以「▲ 红」读作「涨了，而且这是坏事」。

### 改一张图

图表函数都在 `preview/dashboard.html` 里，互相独立：

| 函数 | 画什么 |
|---|---|
| `barChart` | 柱 + 可选移动平均线（`ma: false` 关掉） |
| `lineChart` | 多序列折线，可混柱；`tipRows` 可换 tooltip |
| `stackChart` | 堆叠柱（产品构成） |
| `donut` | 环形图，`link` 参数把图例接上做双向高亮 |
| `ranking` / `table` | 排行条 / 普通表 |

悬停高亮的两套机制别搞混：柱状图用 `focusCol()`+`moveBand()`（压暗其余 + 背景色带），环形图用 `.ring-focus` CSS 类。**色带位置必须由调用方给横向排布**（`geo.cx` / `geo.hit`）—— 柱状图是一格一根、柱心在格心，折线是首尾点压在边界上，两套差半格，用错了色带和柱子会错开（这个 bug 存在过）。

### 改飞书字段映射

`lib/feishu/workbook.ts`。原则：

- **按列名找列**（`col(grid, 'GMV')`），不按列号 —— 表里插一列所有列号就全错位
- 按**子表标题**定位页签，不按 sheet_id —— id 是内部生成的，表被复制就变
- 认不出的行**跳过**，不猜。宁可少一行也不要猜错一行
- 加了解析逻辑就顺手加一个**校验和**：源表里如果有 YTD / 合计行，拿它对一下总数。「读到了 12 个月」和「读对了」是两件事 —— 漏一行、串一列，月份数照样是 12

改完 `npm run sync`，看告警区。告警是设计的一部分，不是噪音。

### 发布

```bash
npm run sync           # 拉飞书 → data/snapshots/latest.json
npm run build:static   # 烤进 HTML → dist/index.html
```

线上是 GitHub Pages，靠 `.github/workflows/pages.yml`：push 到指定分支、每天 UTC 02:30（北京 10:30）、或手动触发。详见 `references/deploy.md` —— 里面有一个必须知道的坑（定时任务只在默认分支生效）。

## 已知的坑

**投放费会回补。** 源表里最近 1–2 天的投放数据当天不全，第二天才补齐。所以看板上「昨天」的投放费天然偏小，隔天会自己变大。这不是 bug，报数时要说清楚。

**目标表有两个区块。** `1.目标达成` 左侧「月汇总」有全部 12 个月但只有 5 个指标；右侧「项目」有 15 个指标但只铺到当月。两个都要读，右侧覆盖左侧。源表这两处在 1/5/6 月的总投放费上互相矛盾（差 1 万上下），当前取右侧（等于站内+站外，和拆分行自洽），同步时会告警。

**看板是公开的。** GitHub Pages 没有密码，拿到网址就能看到全量 GMV、投放费、利润和搜索词。加任何内部链接前先想一遍。

**别把凭据写进页面。** 页面是公开静态文件，任何写进去的 token 等于公开。「刷新」按钮做的是重新取一次页面，不是去连飞书 —— 这是有意的。

## 参考文件

需要时再读，别一次全加载：

- `references/data-pipeline.md` —— 飞书六个页签各自的结构、字段映射全表、两个目标区块的细节
- `references/conventions.md` —— 统计口径与视觉规范的完整清单（含每条的理由）
- `references/dashboard-anatomy.md` —— 单文件 HTML 的内部结构：DATA 形状、六个板块的渲染入口、动效与状态约定
- `references/deploy.md` —— 发布、定时构建、secrets、以及定时任务不生效时怎么查
- `scripts/xcmp.mjs` —— 数值对账脚本（配合 `scripts/xcheck.ts` 用）
- `scripts/probe-template.mjs` —— Playwright 交互探针模板
