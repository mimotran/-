# 单文件看板的内部结构

`preview/dashboard.html` 约 600KB，其中 95% 是内联的 `DATA`。真正的代码约 4000 行，全在一个 `<script>` 里。

## 目录

- [文件的四段](#文件的四段)
- [DATA 的形状](#data-的形状)
- [六个板块的入口](#六个板块的入口)
- [通用工具](#通用工具)
- [状态与交互约定](#状态与交互约定)
- [改动时的注意事项](#改动时的注意事项)

## 文件的四段

```
1. <style>        设计令牌（:root 变量）+ 全部样式，含深色模式
2. <header><main> 骨架 DOM：顶栏、六个 <section>、页尾
3. const DATA     构建产物，不要手改
4. <script>       全部逻辑
```

深色模式定义了三次，别删任何一份：`:root`（浅色基准）、`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }`（跟随系统）、`:root[data-theme="dark"]`（显式切换）。少一份就会在某种组合下失效。

## DATA 的形状

```js
DATA = {
  daily: { dates: [...], cols: { gmv: [...], uv: [...], ... } },   // 按列存，223 天
  adDaily: { insite: {...}, offsite: {...} },                       // 分触点/渠道
  adTotalDaily: { insite: {cost,gmv,orders,...}, offsite: {...} },  // 汇总块
  productDaily: {...}, trafficDaily: {...},
  kw: {...},                    // 搜索词矩阵，CSR 编码
  storeMetrics: { core: [...], extra: [...] },   // KPI 卡的定义（来自 lib）
  goalMetrics: [...], targets: [...], monthlyActuals: {...},
  goals: [...],                 // 预算好的五档达成（MTD/QTD/H2TD/YTD/自定义）
  stats: [...],                 // 昨日 / 本月 / 全年三档 KPI
  insite/offsite/products/trafficChannels: {...},  // 各板块拆解
  source, syncedAt, latestDate, earliestDate,
}
```

**按列存不是为了省事，是为了任意区间。** 页面要支持用户随便选日期，所以带了一份完整日序列，在浏览器里现算。这意味着**聚合逻辑在页面里重写了一遍** —— 和 `lib/metrics.ts` 的 `aggregateRange` 必须一致，靠 `xcheck` + `xcmp` 对账（见 SKILL.md 的验证循环）。

页面侧的核心函数：

- `rangeSlice(from, to)` → `[lo, hi]` 下标
- `aggregate(from, to)` → 和 lib 的 `Aggregate` 同构
- `trendRange(from, to)` → 每天一个对象，含派生字段（比率、adCost 合计等）

**给趋势图加指标时要在 `trendRange` 里补字段** —— KPI 卡的数据来自 `stats`，趋势图的来自 `trendRange`，两条路。

## 六个板块的入口

每个板块是一个 `<section id="sec-xxx">`，靠顶栏 tab 切 `hidden`。渲染入口：

| 板块 | id | 主要函数 |
|---|---|---|
| 目标达成 | `sec-goal` | `renderGoals()` + `buildCustomGoal()` |
| 店铺整体 | `sec-store` | `drawStore()`（KPI 卡 + 趋势图） |
| 站内投放 | `sec-insite` | `mountTrendCard()` / `renderAdTotals()` / `renderBreakdown()` |
| 站外投放 | `sec-offsite` | 同上，共用一套，靠 `scope` 参数区分 |
| 产品 | `sec-product` | 一个 IIFE 里三张图：`drawDaily()` / `drawMonth()` / `drawYear()` |
| 流量 | `sec-traffic` | 流量总览表 + 来源表 + 搜索词排行 |

板块切换是 `display` 显隐，元素从 `none` 变回来时 CSS 动画会自己重放 —— 正好拿来当切换动效，不用在 JS 里加类再删类。

## 通用工具

### 图表

| 函数 | 用途 | 关键参数 |
|---|---|---|
| `barChart(el, pts, pick, opts)` | 柱 + 移动平均 | `ma: false` 关掉均线（`0` 会被 `\|\|` 当成"没传"） |
| `lineChart(el, pts, series, opts)` | 多序列折线，可混柱 | `tipRows` 换 tooltip；序列带 `bar: true` 画成柱 |
| `stackChart(...)` | 堆叠柱 | `overlay` 可叠加自定义图层 |
| `donut(el, segs, fmt, opts)` | 环形 | `hole` 内径、`center`/`centerSub` 圆心文字、`link` 接图例联动 |
| `ranking` / `table` | 排行条 / 表格 | |
| `mountRangeZoom(...)` | 区间滑块 + 滚轮缩放 | 只挂一次，重画时调 `paint()` |
| `hookTip(el, pts, rows, W, M, pw, geo)` | 准星 / 色带 + tooltip | **`geo` 必须由调用方给**，见 conventions.md |

### 格式化

`fmtCurrency` / `fmtInt` / `fmtPct` / `fmtMult` / `fmtCompact` / `fmtExact` / `fmtBy(v, format)`。

金额一律走 `fmtCurrency`（自动切万/亿），需要精确值时用 `fmtExact`。tooltip 里两个都给：紧凑值负责一眼读出量级，精确值负责能抄进 Excel。

### 时间区间

`presetWindow(days, custom)` / `RANGE_PRESETS` / `autoApply(fromId, toId, applyId)` / `syncCustomUi(...)`。

滚轮或滑块改了区间之后，要把预设按钮切到「自定义」并把日期填回输入框 —— 不切的话按钮还高亮着「近 30 天」、图上却是别的区间，自相矛盾。

## 状态与交互约定

**模块级状态用闭包**，不挂全局。产品板块整个是一个 IIFE，`solo`（单看某产品）、`mi`（指标下标）都在里面。

**重绘时重建 DOM，事件用委托。** 图表每次重画都换掉所有 `<path>`/`<rect>`，所以事件挂在 `<svg>` 上而不是逐个元素绑。常驻元素（图例容器、下拉面板）只绑一次，用 `el.__ringFocus = fn` 这样的方式转发给最新一版的处理函数 —— 每次重绘都 `addEventListener` 会越积越多。

**`hidden` 要显式压一层。** UA 的 `[hidden]{display:none}` 优先级低于 `.kpis{display:grid}` 这类作者规则，所以有 `[hidden] { display: none !important; }`。

**日期输入框常驻，不用 `hidden` 切换。** 原来非自定义时 `display:none`，一切到自定义它就冒出来、把同一行的按钮整体往左挤；而滚轮缩放本身就会自动切成自定义 —— 于是「滚一下鼠标按钮跳一下」。常驻之后布局是死的，非自定义时压低对比度表示它只是在跟随。

## 改动时的注意事项

**搜索这个文件时避开 DATA。** 那一行有 60 万字符，`grep` 会把它整行打出来。用 `grep -n` 加上具体模式，或者按行号读（DATA 大约在第 1250 行，代码在它之后）。

**改完必查语法。** HTML 里的 JS 不过 tsc，写错了只有打开页面才知道：

```bash
node -e "const fs=require('fs');const h=fs.readFileSync('preview/dashboard.html','utf8');
  fs.writeFileSync('/tmp/s.js',[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1]);"
node --check /tmp/s.js
```

**别把 `preview/dashboard.html` 和构建产物搞混。** 工作流是：改 `preview/dashboard.html` → `npm run build:static` 读它、换掉 DATA、写出 `dist/index.html`。如果你把 `dist/index.html` 拷回 `preview/dashboard.html`（为了刷新烤进去的数据），**要先确认你的页面改动已经在 preview 里了** —— 否则会被带着旧代码的产物覆盖掉。这个坑踩过。

**两处都要跟着改的地方：**

- KPI 指标定义在 `lib/metrics.ts`，但趋势图能画哪些指标在页面的 `STORE_CHARTS` + `trendRange`
- 目标行的定义在 `lib/metrics.ts` 的 `GOAL_METRICS`，但自定义区间的目标是页面里的 `buildCustomGoal()` 现算的
- CSV 导出的表头和表格的表头是两段代码，改了一个记得改另一个
