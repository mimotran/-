# PLAUD 全网控价排查

每周一更新一次：把淘宝/京东搜索结果页的存档解析成排查登记表，推到飞书。

飞书表：https://nicebuild.feishu.cn/sheets/YEDVs46o2hzZ8htBnakcbzNpnrp

## 为什么要人工存 HTML

淘宝和京东都不能直接抓：

- 搜索页要登录态，且有滑块风控，无头浏览器拿不到稳定数据
- 本仓库的运行环境出网白名单不含 `taobao.com` / `jd.com`，代理直接 403

所以每周的输入是**你在自己浏览器里另存的页面**，脚本只负责解析和汇总。

## 每周操作

1. 淘宝：打开 `https://s.taobao.com/search?q=plaud`，Ctrl+S 存「网页，全部」，翻到第 4 页，共 4 个文件
2. 京东：打开 `https://search.jd.com/Search?keyword=plaud&enc=utf-8`，
   **先滚到页面底部**（京东是滚动加载，不滚只存到前 30 个），再 Ctrl+S，共 5 页
3. 跑下面三步

```bash
cd tools/price-watch
pip install openpyxl beautifulsoup4 lxml

# 解析 + 去重
python3 parse.py    淘宝1.html 淘宝2.html 淘宝3.html 淘宝4.html > rows_raw.json
python3 parse_jd.py 京东1.html 京东2.html 京东3.html 京东4.html 京东5.html > jd_raw.json
python3 -c "
import json
for src, dst in (('rows_raw.json','rows.json'), ('jd_raw.json','jd_rows.json')):
    seen, out = set(), []
    for x in json.load(open(src)):
        if not x['shop']: continue
        k = x['item_id'] or ('AD', x['shop'], x['title'])
        if k in seen: continue
        seen.add(k); out.append(x)
    json.dump(out, open(dst,'w'), ensure_ascii=False, indent=1)
    print(dst, len(out))
"

# 生成 xlsx（排查日期默认取当天）
python3 build.py

# 推飞书（原地更新，不删表重建）
FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=xxx python3 - <<'EOF'
import sys; sys.path.insert(0,'.')
from push_feishu import auth, load_data, update_sheets, \
    apply_lowprice_fill, apply_dashboard_style, apply_number_formats
tok = auth(); T = "YEDVs46o2hzZ8htBnakcbzNpnrp"
update_sheets(tok, T, load_data())
apply_lowprice_fill(tok, T)
apply_dashboard_style(tok, T)
apply_number_formats(tok, T)
EOF
```

补录历史某一周用 `PRICE_WATCH_DATE=2026-09-14 python3 build.py`。

## 飞书应用

需要一个企业自建应用，权限：`drive:drive`、`sheets:spreadsheet`，**开完必须「创建版本并发布」**
（否则接口返回 99991672）。凭据只从环境变量读，不要写进文件。

表的所有者已转给 mimo@plaud.ai，所以换应用不影响这张表。

## 统计口径

| 项 | 规则 |
|---|---|
| 官方指导价 | PLAUD NOTE ¥999；其余型号 国内版 ¥1299 / 海外版 ¥1399 |
| 低价 | 违规售价 < 该型号该版本的指导价。一条商品链接算一条，同店多链接分别计 |
| 版本判定 | ①标题写国行 → 国内版；②标题含 海外版/国际版/港版/行货/代购… → 海外版；③店名含 香港/深港/海外/代购/全球购/环球/免税/跨境 → 海外版；④都没有 → 国内版并标「需人工复核」 |
| 排除 | 官方自营店（PLAUD旗舰店、PLAUD京东自营旗舰店）；配件（标题含「适用」或充电线/贴膜/表带/保护壳等）；「同款/替代」仿品（移入单独页签，走知产投诉而非控价） |
| 违规售价 | 搜索结果页展示价。京东取券后到手价，页面标价记在备注 |

## 踩过的坑

这几条是实测出来的，改代码前先看一眼：

- **飞书 `tenant_access_token` 在响应顶层**，不在 `data` 里。按 `data.` 取会拿到
  `None`，但报错信息是「Missing access token」，很误导。
- **`sheets_batch_update` 只有 v2**，调 v3 返回非 JSON 的 404。
- **values 接口不传数字格式**，写 `0.3548` 过去就显示 `0.3548`。要么调
  `styles_batch_update` 的 `formatter`，要么直接写成字符串（看板走的后者）。
- **飞书 formatter 只认自己那套写法**：`0.00%` / `#,##0.00` 可以，
  `0.0%` / `0.00` 返回 90204。映射表见 `push_feishu.py` 的 `FMT_MAP`。
- **style 的 range 不能超过工作表实际行数**，否则 90202。
- **淘宝广告位卡片的 simba 链接里 `s=` 是投放位标识，全站同值，不是 sellerId。**
  拿它拼店铺链接会指向不存在的店。广告位没有 appUid，靠同店自然结果按店名回填。
- **京东搜索页不暴露 venderId**，页面里 `shopId`/`sellerId`/`mall.jd.com` 全是 0 处，
  卡片内所有 `<a>` 都指向客服。所以京东只有商品链接，没有店铺链接。
- **京东标题带品牌前缀**（「子蓝适用…」「awxt适用…」），判配件不能只看 `startswith("适用")`。

## 已知缺口

- 京东第 5 页那次只存到 2 个商品（没滚到底），数据不全
- 3 条淘宝链接售价 ¥158/¥189，是多规格最低价（配件 SKU 或定金），
  需进商品页核实主机实际售价，表里已标 ⚠
