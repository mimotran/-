# -*- coding: utf-8 -*-
"""把解析出的淘宝搜索结果整理成控价排查登记表。"""

import datetime
import json
import os
import re
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

BASE = os.path.dirname(os.path.abspath(__file__))
SRC_TB = f"{BASE}/rows.json"
SRC_JD = f"{BASE}/jd_rows.json"
# 排查日期默认取当天，需要补录历史时用 PRICE_WATCH_DATE=2026-09-14 覆盖
DATE = os.environ.get("PRICE_WATCH_DATE") or datetime.date.today().isoformat()
OUT = f"{BASE}/PLAUD_全平台非授权店铺排查登记表_{DATE.replace('-', '')}.xlsx"

# 确认的官方自营店，排查对象之外
OFFICIAL_SHOPS = {"PLAUD旗舰店", "PLAUD京东自营旗舰店"}
# 业务已确认非官方的店铺，正常计入排查（京东「PLAUD」「钉钉」于 2026-09-14 确认）
SUSPECT_OFFICIAL = set()

# 官方指导价（用户确认）：PLAUD NOTE 单独 999，其余按版本取
GUIDE = {"国内版": 1299.00, "海外版": 1399.00}
GUIDE_BY_MODEL = {"PLAUD NOTE": 999.00}


def guide_of(model, ver):
    return GUIDE_BY_MODEL.get(model, GUIDE[ver])

HEAD_FILL = PatternFill("solid", fgColor="1F4E79")
HEAD_FONT = Font(name="微软雅黑", size=10, bold=True, color="FFFFFF")
BODY_FONT = Font(name="微软雅黑", size=10)
LINK_FONT = Font(name="微软雅黑", size=10, color="0563C1", underline="single")
WARN_FILL = PatternFill("solid", fgColor="FFF2CC")   # 浅黄：售价低于官方指导价
NOTE_FILL = PatternFill("solid", fgColor="FFF2CC")
THIN = Side(style="thin", color="BFBFBF")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


# 配件关键词：命中即不是主机，整条排除出控价口径
ACCESSORY_KW = (
    "充电线", "数据线", "充电器", "座充", "快充", "电源线", "充电套",
    "贴膜", "保护膜", "钢化膜", "水凝膜", "屏幕膜",
    "保护套", "保护壳", "硅胶套", "收纳包", "收纳盒",
    "表带", "腕带", "手环", "挂绳", "背夹", "磁吸贴",
    "卡包", "卡套", "皮套", "会员",
)


def is_accessory(title):
    """京东标题常带品牌前缀（「子蓝适用…」「awxt适用…」），不能只看开头。"""
    if "适用" in title:
        return True
    if re.match(r"^\s*for\s*plaud", title, re.I):      # ForPLAUDNotePin…
        return True
    return any(k in title for k in ACCESSORY_KW)


def model_of(title):
    t = re.sub(r"[\s\-]", "", title).lower()
    if is_accessory(title):
        return "配件/增值服务"
    if "notepins" in t or "pins" in t:
        return "PLAUD NotePin S"
    if "notepin" in t:
        return "PLAUD NotePin"
    if "notepro" in t:
        return "PLAUD Note Pro"
    if "plaudnote" in t:
        return "PLAUD NOTE"
    return "待确认"


def shop_type(name, platform="淘宝"):
    if platform == "京东":
        if "自营" in name:
            return "京东自营"
        if name.endswith("旗舰店"):
            return "京东POP旗舰店"
        if "专营店" in name:
            return "京东专营店"
        if "专卖店" in name:
            return "京东专卖店"
        return "京东POP店"
    if name.endswith("旗舰店"):
        return "天猫旗舰店"
    if "专卖店" in name:
        return "天猫专卖店"
    if "专营店" in name:
        return "天猫专营店"
    if "企业店" in name:
        return "淘宝企业店铺"
    return "淘宝个人店铺(C店)"


OVERSEAS_KW = ("海外版", "国际版", "國際版", "海外模型", "香港", "港版", "行货", "行貨",
               "平行进口", "海淘", "代购", "代購", "全球购", "环球购", "保税", "直邮")
# 店铺名带这些字样的，主营就是跨境货，标题不写版本也按海外版算
OVERSEAS_SHOP_KW = ("香港", "深港", "海外", "代购", "代購", "全球购", "全球購",
                    "环球", "環球", "免税", "免稅", "跨境", "海淘", "直邮", "直郵", "保税")
# 标题明确写了国行的，优先级最高，压过店铺属性
DOMESTIC_KW = ("国行", "國行", "国内版", "大陆版", "内地版", "国产版")


def version_of(title, shop=""):
    """返回 (版本, 判定依据)。依据为空表示既没标题也没店名线索，需人工复核。"""
    if any(k in title for k in DOMESTIC_KW):
        return "国内版", "标题标称国行"
    hit = [k for k in OVERSEAS_KW if k in title]
    if hit:
        return "海外版", "标题标称「" + "、".join(hit) + "」"
    shop_hit = [k for k in OVERSEAS_SHOP_KW if k in shop]
    if shop_hit:
        return "海外版", "店名含「" + "、".join(shop_hit) + "」，主营跨境货"
    return "国内版", ""


def store_url(r):
    """只有拿到真实 appUid 才给链接。

    广告位卡片的 simba 链接里 s= 是投放位标识（全站同值），不是 sellerId，
    拿它拼 view_shop 会指向不存在的店（点进去「没有店铺信息」）。
    """
    if r.get("app_uid"):
        return f"https://store.taobao.com/category.htm?appUid={r['app_uid']}"
    return ""


def put_link(cell, url):
    if url:
        cell.hyperlink = url
        cell.font = LINK_FONT


rows = []
for path, plat in ((SRC_TB, "淘宝"), (SRC_JD, "京东")):
    for r in json.load(open(path, encoding="utf-8")):
        r.setdefault("platform", plat)
        rows.append(r)

# 广告位卡片缺 appUid，但同一家店往往也出现在自然结果里，按店名回填
UID_BY_SHOP = {}
for r in rows:
    if r.get("platform", "淘宝") == "淘宝" and r.get("app_uid"):
        UID_BY_SHOP.setdefault(r["shop"], r["app_uid"])
for r in rows:
    if r.get("platform", "淘宝") == "淘宝" and not r.get("app_uid"):
        uid = UID_BY_SHOP.get(r["shop"])
        if uid:
            r["app_uid"], r["uid_inferred"] = uid, True

listings, offtopic, official = [], [], []
for r in rows:
    title, shop = r["title"], r["shop"]
    # 广告位卡片没有 item_id 也没有 appUid，但店名/标题/价格都在，照样要登记
    if not shop or not title:
        continue
    if shop in OFFICIAL_SHOPS:         # 官方自营，本次排查对象之外
        official.append(r)
        continue
    if is_accessory(title):
        continue                                # 配件不在控价范围，整条丢弃
    if "plaud" not in title.lower():
        continue
    if "同款" in title or "替代" in title:      # 仿品 / 竞品蹭品牌词
        offtopic.append((r, "「同款/替代」表述，非 PLAUD 正品"))
        continue
    # 型号标识：plaud 紧跟 note/pin，或出现 NB-100 这类料号
    if not re.search(r"plaud\s*(note|pin|nb-?\d)", title, re.I) \
            and not re.search(r"\bnb-?100\b|notepin|note\s*pro", title, re.I):
        offtopic.append((r, "疑似关键词蹭词，商品本身非 PLAUD"))
        continue
    listings.append(r)

# 蹭词补判：标题以通用描述开头、plaud 只出现在结尾
for r in list(listings):
    if re.match(r"^(ai|AI)?智能录音笔", r["title"]) and r["title"].lower().find("plaud") > 15:
        listings.remove(r)
        offtopic.append((r, "疑似关键词蹭词，商品本身非 PLAUD"))

# 官方配件本身不在控价口径内，一并剔除
listings = [r for r in listings if model_of(r["title"]) != "配件/增值服务"]
PLAT_ORDER = {"淘宝": 0, "京东": 1}


def plat_key(r):
    return PLAT_ORDER.get(r.get("platform", "淘宝"), 9)


listings.sort(key=lambda r: (plat_key(r), r["shop"], r["title"]))
offtopic.sort(key=lambda t: (plat_key(t[0]), t[0]["shop"], t[0]["title"]))

wb = Workbook()

# ------------------------------------------------------------ Sheet 1
ws = wb.active
ws.title = "排查登记表"
COLS = [("序号", 6), ("排查日期", 12), ("平台", 8), ("卖家昵称", 20), ("卖家ID/UID", 26),
        ("店铺类型", 18), ("商品链接URL", 46), ("店铺链接", 46), ("产品型号", 17),
        ("版本", 10), ("违规售价", 11), ("官方指导价", 12), ("价差(元)", 10),
        ("低价幅度", 10), ("月销", 11), ("发货地", 12), ("备注", 58)]
IDX = {name: i for i, (name, _) in enumerate(COLS, 1)}

for i, (name, w) in enumerate(COLS, 1):
    c = ws.cell(row=1, column=i, value=name)
    c.fill, c.font, c.border = HEAD_FILL, HEAD_FONT, BORDER
    c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.column_dimensions[get_column_letter(i)].width = w
ws.row_dimensions[1].height = 28
ws.freeze_panes = "A2"
ws.auto_filter.ref = f"A1:{get_column_letter(len(COLS))}1"

r_ = 2
for n, x in enumerate(listings, 1):
    model = model_of(x["title"])
    price = float(x["price"]) if x["price"] else None
    ver, why = version_of(x["title"], x["shop"])
    guide = guide_of(model, ver)

    plat = x.get("platform", "淘宝")
    notes = []
    if x["shop"] in SUSPECT_OFFICIAL:
        notes.append("⚠ 疑似官方/授权渠道，授权状态待业务确认，确认后应移出本表")
    if ver == "海外版":
        notes.append(f"{why}，疑似跨境水货/平行进口")
    elif why:
        notes.append(why)
    else:
        notes.append("标题与店名均未见版本线索，按国内版计价，需人工复核")
    if price and price > guide * 1.15:
        notes.append("高于指导价，疑似套装/代购加价，需核实规格")
    if price and price < guide * 0.5:
        notes.insert(0, "⚠ 售价不足指导价 50%，搜索页展示的多为最低规格价"
                        "（配件SKU/定金/单买壳膜），必须进商品页核实主机实际售价后再定性")
    if not x["item_url"] and x.get("ad_url"):
        notes.append("广告位卡片无商品直链，本列填的是广告跳转链接（点击可达商品页）")
    if x.get("uid_inferred"):
        notes.append("卖家ID按店名从该店自然搜索结果回填，非本条卡片自带")
    elif plat == "淘宝" and not x.get("app_uid"):
        notes.append("广告位卡片不含店铺 appUid，卖家ID与店铺链接需从商品页取")
    if plat == "京东":
        if x.get("listed_price"):
            notes.append(f"页面标价 ¥{x['listed_price']}，本列取券后到手价")
        if x.get("tags"):
            notes.append(f"促销标：{x['tags'][:30]}")
        notes.append("京东搜索页不暴露 venderId，卖家ID需从商品页取")
    notes.append(f"原标题：{x['title'][:40]}")

    vals = [n, DATE, plat, x["shop"], x["seller_id"] or x["app_uid"],
            shop_type(x["shop"], plat), x["item_url"] or x.get("ad_url", ""),
            store_url(x), model, ver,
            price, guide, None, None, x["sales"], x["loc"], "；".join(notes)]
    for i, v in enumerate(vals, 1):
        c = ws.cell(row=r_, column=i, value=v)
        c.font, c.border = BODY_FONT, BORDER
        c.alignment = Alignment(vertical="center", wrap_text=False)

    put_link(ws.cell(row=r_, column=IDX["商品链接URL"]), x["item_url"] or x.get("ad_url", ""))
    put_link(ws.cell(row=r_, column=IDX["店铺链接"]), store_url(x))

    pcol = get_column_letter(IDX["违规售价"])
    gcol = get_column_letter(IDX["官方指导价"])
    ws.cell(row=r_, column=IDX["价差(元)"],
            value=f'=IF(AND(ISNUMBER({pcol}{r_}),ISNUMBER({gcol}{r_})),{gcol}{r_}-{pcol}{r_},"")')
    ws.cell(row=r_, column=IDX["低价幅度"],
            value=f'=IF(AND(ISNUMBER({pcol}{r_}),ISNUMBER({gcol}{r_}),{gcol}{r_}>0),'
                  f'({gcol}{r_}-{pcol}{r_})/{gcol}{r_},"")')
    for name, fmt in (("违规售价", "0.00"), ("官方指导价", "0.00"),
                      ("价差(元)", "0.00"), ("低价幅度", "0.0%")):
        ws.cell(row=r_, column=IDX[name]).number_format = fmt

    # 低于指导价：只标「违规售价」这一格，不整行铺色
    if price is not None and price < guide:
        ws.cell(row=r_, column=IDX["违规售价"]).fill = WARN_FILL
    r_ += 1

# ------------------------------------------------------------ Sheet 2
sm = wb.create_sheet("店铺汇总")
for i, (name, w) in enumerate([("序号", 6), ("平台", 8), ("卖家昵称", 24), ("卖家ID/UID", 26),
                               ("店铺类型", 18), ("在架链接数", 12), ("最低售价", 11),
                               ("涉及型号", 30), ("涉及版本", 14), ("店铺链接", 46)], 1):
    c = sm.cell(row=1, column=i, value=name)
    c.fill, c.font, c.border = HEAD_FILL, HEAD_FONT, BORDER
    c.alignment = Alignment(horizontal="center", vertical="center")
    sm.column_dimensions[get_column_letter(i)].width = w
sm.freeze_panes = "A2"

agg = {}
for x in listings:
    # 京东 venderId 与淘宝 appUid 是两套体系，同名店不合并
    key = (x.get("platform", "淘宝"), x["shop"])
    a = agg.setdefault(key, {"uid": x["seller_id"] or x["app_uid"], "n": 0,
                             "min": None, "models": set(), "vers": set(), "url": ""})
    a["url"] = a["url"] or store_url(x)
    a["n"] += 1
    a["models"].add(model_of(x["title"]))
    a["vers"].add(version_of(x["title"], x["shop"])[0])
    p = float(x["price"]) if x["price"] else None
    if p is not None:
        a["min"] = p if a["min"] is None else min(a["min"], p)

agg_sorted = sorted(agg.items(),
                    key=lambda kv: (PLAT_ORDER.get(kv[0][0], 9), -kv[1]["n"], kv[0][1]))
for n, ((plat, shop), a) in enumerate(agg_sorted, 1):
    vals = [n, plat, shop, a["uid"], shop_type(shop, plat), a["n"], a["min"],
            "、".join(sorted(a["models"])), "、".join(sorted(a["vers"])), a["url"]]
    for i, v in enumerate(vals, 1):
        c = sm.cell(row=n + 1, column=i, value=v)
        c.font, c.border = BODY_FONT, BORDER
    sm.cell(row=n + 1, column=7).number_format = "0.00"
    put_link(sm.cell(row=n + 1, column=10), a["url"])

# ------------------------------------------------------------ Sheet 3
ot = wb.create_sheet("同款仿品与蹭词")
for i, (name, w) in enumerate([("平台", 8), ("卖家昵称", 22), ("商品标题", 62), ("售价", 10),
                               ("商品链接URL", 44), ("判定", 30)], 1):
    c = ot.cell(row=1, column=i, value=name)
    c.fill, c.font, c.border = HEAD_FILL, HEAD_FONT, BORDER
    ot.column_dimensions[get_column_letter(i)].width = w
for n, (x, why) in enumerate(offtopic, 2):
    for i, v in enumerate([x.get("platform", "淘宝"), x["shop"], x["title"],
                           float(x["price"]) if x["price"] else None,
                           x["item_url"], why], 1):
        c = ot.cell(row=n, column=i, value=v)
        c.font, c.border = BODY_FONT, BORDER
    put_link(ot.cell(row=n, column=5), x["item_url"])

# ------------------------------------------------------------ Sheet 4
doc = wb.create_sheet("数据来源与口径")
doc.column_dimensions["A"].width = 18
doc.column_dimensions["B"].width = 92
LINES = [
    ("项", "说明"),
    ("数据来源", "淘宝 PC 端搜索「plaud」结果第 1 页，用户于 2026-09-11 本地浏览器另存的 HTML，由脚本解析，无人工誊写。"),
    ("覆盖范围", "仅第 1 页（含 2 个广告位）。后续页码需另存后补录，本表尚未覆盖。"),
    ("排除项", "PLAUD旗舰店自营链接已剔除；第三方配件（标题以「适用」开头的充电线/贴膜/表带/保护壳）"
             "及 PLAUD 官方配件整条丢弃，不在控价口径内；「同款/替代」仿品与关键词蹭词移入"
             "「同款仿品与蹭词」页签，走知产投诉而非控价。"),
    ("卖家ID/UID", "广告位取 simba 链接 s= 参数，为数字 sellerId；自然位取店铺链接 appUid（淘宝加密店铺标识），"
                  "可直接拼 store.taobao.com/category.htm?appUid=… 打开店铺。两者都能唯一定位卖家。"),
    ("违规售价", "搜索结果页展示价，未计店铺券与跨店满减，实际到手价可能更低。进入处置流程前须进商品页复核到手价。"),
    ("官方指导价", "PLAUD NOTE 统一 ¥999，不分版本；其余型号按版本取：国内版 ¥1299、海外版 ¥1399。"
                "均为业务方确认口径。注意 NOTE 有 1 条标题标称海外版，也按 ¥999 计——"
                "若海外版 NOTE 另有价格，告知后批量改。"),
    ("版本判定", "依据商品标题关键词：出现「海外版/国际版/海外模型/香港/港版/行货/平行进口」判为海外版，"
               "其余按国内版计价。标题未明示版本的行，备注已注明「需人工复核」——"
               "卖家不写版本不代表就是国内版，这批要进商品页逐条确认。"),
    ("底色标记", "橙色行 = 售价低于本版本指导价，为优先核查对象。"),
    ("海外版处置", "海外版多为跨境水货/平行进口，处置路径与单纯低价不同，建议单独立案。"),
    ("下一步", "1) 用官方指导价替换 J 列；2) 逐条进商品页复核到手价并截图取证；"
             "3) 另存搜索结果第 2–5 页 HTML 补录；4) 按 appUid 归并同一卖家的多链接。"),
]
for r, (a, b) in enumerate(LINES, 1):
    ca, cb = doc.cell(row=r, column=1, value=a), doc.cell(row=r, column=2, value=b)
    if r == 1:
        ca.fill = cb.fill = HEAD_FILL
        ca.font = cb.font = HEAD_FONT
    else:
        ca.font = Font(name="微软雅黑", size=10, bold=True)
        cb.font = BODY_FONT
        if a in ("官方指导价", "覆盖范围", "版本判定"):
            cb.fill = NOTE_FILL
    ca.alignment = Alignment(vertical="top")
    cb.alignment = Alignment(vertical="top", wrap_text=True)

# ------------------------------------------------------------ Sheet 0：看板
# 每周一更新：本周结果并进 history.json，看板渲染全部历史，按日期分组。
# 占比一律写成字符串——飞书 values 接口不带数字格式，写小数过去会显示成 0.3548…
import collections

FOCUS = ("PLAUD Note Pro", "PLAUD NotePin S")
SERIES = {"国内版": "5B8FD4", "海外版": "D98763"}   # 过 CVD 校验，见 dataviz skill
BAND = PatternFill("solid", fgColor="EEF3F9")
INK, MUTED, FADE = "2F3A45", "8A8F98", "C8CCD2"
UP, DOWN = "C0504D", "4F8A5B"
HAIR = Side(style="thin", color="E3E6EA")
SOFT_BORDER = Border(bottom=HAIR)
HISTORY = f"{BASE}/history.json"

tot_c, low_c, shop_c = collections.Counter(), collections.Counter(), collections.defaultdict(set)
for x in listings:
    m = model_of(x["title"])
    if m not in FOCUS:
        continue
    v = version_of(x["title"], x["shop"])[0]
    k = (m, x.get("platform", "淘宝"), v)
    tot_c[k] += 1
    p = float(x["price"]) if x["price"] else None
    if p is not None and p < guide_of(m, v):
        low_c[k] += 1
        shop_c[k].add(x["shop"])

CELLS = [(m, p, v) for m in FOCUS for p in ("淘宝", "京东") for v in SERIES]

hist = json.load(open(HISTORY, encoding="utf-8")) if os.path.exists(HISTORY) else {}
hist[DATE] = {"|".join(k): [low_c[k], tot_c[k], len(shop_c[k])] for k in CELLS}
json.dump(hist, open(HISTORY, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
weeks = sorted(hist)

dash = wb.create_sheet("看板", 0)
for col, w in zip("ABCDEFGHI", (12, 17, 8, 9, 8, 8, 9, 20, 8)):
    dash.column_dimensions[col].width = w

F = lambda sz, b=False, c=INK: Font(name="微软雅黑", size=sz, bold=b, color=c)
pct = lambda n, t: f"{n / t:.1%}" if t else "—"

cur = hist[DATE]
n_low = sum(v[0] for v in cur.values())
n_tot = sum(v[1] for v in cur.values())
n_shop = len({s for k in shop_c for s in shop_c[k]})
BAR_MAX = max((v[0] for wk in hist.values() for v in wk.values()), default=1) or 1

dash["A1"] = "PLAUD 低价链接分布"
dash["A1"].font = F(13, True)
dash["A2"] = (f"Note Pro 与 NotePin S｜指导价 国内版 ¥1299 / 海外版 ¥1399"
              f"｜低价 = 售价低于对应指导价｜每周一更新")
dash["A2"].font = F(9, c=MUTED)

kpi = [("最新排查日", DATE), ("在架链接", n_tot), ("低价链接", n_low),
       ("低价占比", pct(n_low, n_tot)), ("涉及店铺", n_shop)]
if len(weeks) > 1:
    prev = hist[weeks[-2]]
    d = n_low - sum(v[0] for v in prev.values())
    kpi.append(("较上周低价", f"{d:+d}"))
for i, (lbl, val) in enumerate(kpi):
    dash.cell(row=4, column=1 + i * 2, value=lbl).font = F(9, c=MUTED)
    c = dash.cell(row=5, column=1 + i * 2, value=val)
    c.font = F(14, True)
    if lbl == "较上周低价":
        c.font = F(14, True, UP if d > 0 else (DOWN if d < 0 else INK))

HEADS = ["排查日期", "产品型号", "平台", "版本", "低价", "在架", "占比", "分布", "店铺"]
r = 7
for i, name in enumerate(HEADS):
    c = dash.cell(row=r, column=i + 1, value=name)
    c.font, c.fill = F(9, True, INK), BAND
    c.border = SOFT_BORDER
r += 1

for wk in reversed(weeks):                     # 最新一周排最上面
    snap = hist[wk]
    for idx, k in enumerate(CELLS):
        n, t, sc = snap.get("|".join(k), [0, 0, 0])
        m, plat, v = k
        vals = [wk if idx == 0 else "", m if (plat, v) == ("淘宝", "国内版") else "",
                plat, v, n, t, pct(n, t), "█" * n if n else "—", sc]
        for i, val in enumerate(vals):
            c = dash.cell(row=r, column=i + 1, value=val)
            c.font, c.border = F(10), SOFT_BORDER
        dash.cell(row=r, column=1).font = F(10, True)
        dash.cell(row=r, column=2).font = F(10, True)
        dash.cell(row=r, column=4).font = F(10, True, SERIES[v])
        dash.cell(row=r, column=8).font = F(10, c=SERIES[v] if n else FADE)
        r += 1
    wl = sum(x[0] for x in snap.values())
    wt = sum(x[1] for x in snap.values())
    for i, val in enumerate(["", "小计", "", "", wl, wt, pct(wl, wt), "", ""]):
        c = dash.cell(row=r, column=i + 1, value=val)
        c.font, c.fill = F(10, True), BAND
    r += 2

dash.cell(row=r, column=1,
          value=f"条形长度 = 低价链接条数，全表同一刻度（1 格 = 1 条，历史最长 {BAR_MAX} 条）。"
                f"一条商品链接算一条，同店多链接分别计。历史留存在 history.json。").font = F(9, c=MUTED)

wb.save(OUT)
print("listings:", len(listings), "| shops:", len(agg), "| offtopic:", len(offtopic))
print("saved:", OUT)
