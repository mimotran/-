# 发布与定时构建

## 本地

```bash
npm install
npm run dev            # http://localhost:3000（Next.js 壳，看板本体不依赖它）
npm run sync           # 拉飞书 → data/snapshots/latest.json，打印告警
npm run build:static   # 烤数据进 HTML → dist/index.html
npm run check          # 一致性检查
npx tsx scripts/xcheck.ts > ref.json   # 数值对账的参照
```

没有飞书凭据也能跑，会回落到演示数据，页面顶部有明确提示。

### 环境变量

`.env.local`（已 gitignore，绝不提交）：

```
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_BASE_URL=https://open.feishu.cn/open-apis
FEISHU_WIKI_TOKEN=              # 日报主表的 wiki token
FEISHU_WIKI_TOKEN_KEYWORDS=     # 搜索词表的 wiki token
FEISHU_SHEET_DAILY=             # 子表 id（可选，按标题定位为主）
```

wiki token 就是飞书文档 URL 里 `/wiki/` 后面那一段。

## 线上：GitHub Pages

`.github/workflows/pages.yml`，三种触发：

| 触发 | 何时 |
|---|---|
| `push` | 改了 `preview/dashboard.html`、`lib/**`、`scripts/**`、workflow 自身 |
| `schedule` | 每天 UTC 02:30 = 北京时间 10:30 |
| `workflow_dispatch` | 在 Actions 页面手动点 Run workflow |

流程：checkout → `npm ci` → `npm run build:static`（带 Feishu secrets）→ 上传 `dist/` → deploy-pages。

### 需要配的 Actions secrets

`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_BASE_URL`、`FEISHU_WIKI_TOKEN`、`FEISHU_WIKI_TOKEN_KEYWORDS`，以及几个可选的 `FEISHU_SHEET_*`。

**没配 secrets 时构建照样成功**，但拉不到飞书数据 —— 这时 `build-static.ts` 会**跳过数据替换**，沿用 `preview/dashboard.html` 里已经烤好的那份（提交时点的真实数据），并在日志里说明。绝不会把演示数据发到线上。

### 开启 Pages

仓库 Settings → Pages → Source 选 **GitHub Actions**。如果 `github-pages` 环境设了部署分支限制，要么放开，要么把目标分支加进白名单。

## 定时任务不生效怎么查

**最容易踩的坑：GitHub 的 `schedule` 只在仓库的默认分支上生效。** workflow 文件放在别的分支上时，push 和手动触发都正常，唯独定时**永远不会跑**，而且没有任何报错 —— Actions 页面就是干干净净地什么都没有。

排查顺序：

```bash
# 1. 默认分支是不是 workflow 所在的分支
git ls-remote --symref origin HEAD

# 2. 有没有 event=schedule 的运行记录（0 就是从没跑过）
#    GitHub API: /repos/{owner}/{repo}/actions/workflows/pages.yml/runs?event=schedule

# 3. workflow 是不是被停用了（state 应为 active）
#    GitHub API: /repos/{owner}/{repo}/actions/workflows
```

对应的修法：

| 现象 | 原因 | 修 |
|---|---|---|
| 从没有 schedule 运行 | workflow 不在默认分支上 | Settings → General → Default branch 切过去 |
| `state: disabled_inactivity` | 仓库 60 天没提交，GitHub 自动停用 | 在 Actions 页面点启用 |
| 有记录但迟到很久 | GitHub 的定时是尽力而为，高峰期会排队 | 正常现象；要准点就别指望 cron，用外部定时调 `workflow_dispatch` |

改了 cron 记得同时改**页头那句「每日 10:30 自动同步」** —— 它是写死在 HTML 里的，不会自己跟着变。承诺一件做不到的事比不承诺更糟。

## 「数据没更新」排查

按这个顺序，每一步都能排除一大类原因：

1. **线上有没有新构建？** Actions 里看最近一次成功的运行时间。没有新构建 = 页面不可能有新数据，这时点「刷新」按钮当然没反应 —— 它做的是重新取一次页面，不是去连飞书。
2. **构建成功了但数还是旧的？** 看构建日志里 `生成 dist/index.html（… 截至 X）` 那行。如果 `来源 mock` 或者提示「已跳过数据替换」，就是 secrets 没配上。
3. **数比源表小？** 大概率是**回补**：投放数据当天不全，第二天才补齐。拿源表同一天的数对一下，如果源表现在也变大了，就是回补。
4. **数和源表对不上，且不是回补？** 跑 `npm run sync` 看告警，再跑 `xcheck` + `xcmp` 对账。字段映射错位会在这里露出来。
5. **浏览器缓存。** GitHub Pages 有约 10 分钟缓存，刚部署完那几分钟刷新可能还是旧的。强制刷新（Ctrl/Cmd + Shift + R）。

## 安全

**Pages 是公开的，没有密码。** 拿到网址的人能看到全量 GMV、投放费、利润、搜索词。这是当初选静态托管时接受的代价，加任何东西之前先想一遍会不会连带暴露。

**凭据只在两个地方**：本地 `.env.local`（gitignore）和 GitHub Actions secrets。页面是公开静态文件，任何写进去的 token 等于公开发布。这也是「刷新」按钮只重新取页面、而不是去连飞书的原因。

App Secret 如果曾经出现在聊天记录、截图或日志里，去飞书控制台重置一次。
