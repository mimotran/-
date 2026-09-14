# -*- coding: utf-8 -*-
"""把排查登记表写进飞书知识库里的现成文档（多维表格或电子表格，自动识别）。

用法：
    FEISHU_APP_ID=... FEISHU_APP_SECRET=... WIKI_TOKEN=... python3 push_feishu.py [--dry-run]

凭据只从环境变量读，不落盘、不打印。
"""

import glob
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

from openpyxl import load_workbook

BASE = "https://open.feishu.cn/open-apis"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# 默认挑目录里最新的那个排查表；也可用 PRICE_WATCH_XLSX 指定
XLSX = os.environ.get("PRICE_WATCH_XLSX") or max(
    glob.glob(f"{BASE_DIR}/PLAUD_*.xlsx"), key=os.path.getmtime, default="")
SPREADSHEET_TOKEN = os.environ.get("FEISHU_SPREADSHEET_TOKEN", "")
DRY = "--dry-run" in sys.argv

# 多维表格字段类型
TEXT, NUMBER, SELECT, DATE, URL = 1, 2, 3, 5, 15

STATUS_OPTS = ["待核实", "已取证", "已发函", "已投诉", "平台已下架", "卖家已改价", "已结案"]


def api(method, path, token=None, body=None):
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json; charset=utf-8")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            out = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raw = e.read() or b""
        try:
            out = json.loads(raw)
        except ValueError:                     # 接口不存在时返回的不是 JSON
            raise SystemExit(f"✗ {method} {path}\n  HTTP {e.code}: {raw[:200]!r}")
    if out.get("code"):
        hint = {
            99991672: "权限未开通或未「创建版本并发布」",
            131006: "应用不是该知识库/文档的协作者，去文档里把应用加成可编辑",
            1254302: "没有该多维表格的编辑权限",
        }.get(out["code"], "")
        raise SystemExit(f"✗ {method} {path}\n  code={out['code']} msg={out.get('msg')}"
                         + (f"\n  → {hint}" if hint else ""))
    # tenant_access_token 接口把 token 放在响应顶层，没有 data 包一层
    return out.get("data", out)


def auth():
    d = api("POST", "/auth/v3/tenant_access_token/internal", body={
        "app_id": os.environ["FEISHU_APP_ID"],
        "app_secret": os.environ["FEISHU_APP_SECRET"],
    })
    tok = d.get("tenant_access_token")
    if not tok:
        raise SystemExit(f"✗ 没拿到 tenant_access_token，响应字段：{list(d)}")
    return tok


def resolve_wiki(tok, wiki_token):
    d = api("GET", f"/wiki/v2/spaces/get_node?token={wiki_token}", tok)
    n = d["node"]
    return n["obj_type"], n["obj_token"], n.get("title", "")


# --------------------------------------------------------------- 读取数据
def load_data():
    wb = load_workbook(XLSX)
    out = {}
    for name in wb.sheetnames:
        sh = wb[name]
        head = [c.value for c in sh[1]]
        rows = []
        for r in sh.iter_rows(min_row=2):
            vals, links = [], {}
            for c in r:
                vals.append(c.value)
                if c.hyperlink:
                    links[head[c.column - 1]] = c.hyperlink.target or c.hyperlink.display
            rows.append((vals, links))
        out[name] = (head, rows)

    # 公式列落成数值
    head, rows = out["排查登记表"]
    ip, ig = head.index("违规售价"), head.index("官方指导价")
    idf, irt = head.index("价差(元)"), head.index("低价幅度")
    for vals, _ in rows:
        p, g = vals[ip], vals[ig]
        if isinstance(p, (int, float)) and isinstance(g, (int, float)) and g:
            vals[idf], vals[irt] = round(g - p, 2), (g - p) / g
        else:
            vals[idf] = vals[irt] = None
    return out


def field_spec(name, col_values):
    """按列名和取值决定多维表格字段类型。"""
    if name in ("商品链接URL", "店铺链接"):
        return {"field_name": name, "type": URL}
    if name == "排查日期":
        return {"field_name": name, "type": DATE,
                "property": {"date_formatter": "yyyy/MM/dd"}}
    if name == "低价幅度":
        return {"field_name": name, "type": NUMBER, "property": {"formatter": "0.0%"}}
    if name in ("平台", "店铺类型", "产品型号", "版本", "涉及版本"):
        opts = sorted({str(v) for v in col_values if v})
        return {"field_name": name, "type": SELECT,
                "property": {"options": [{"name": o} for o in opts]}}
    if all(v is None or isinstance(v, (int, float)) for v in col_values) and any(
            isinstance(v, (int, float)) for v in col_values):
        return {"field_name": name, "type": NUMBER,
                "property": {"formatter": "0" if name == "序号" else "0.00"}}
    return {"field_name": name, "type": TEXT}


def cell_value(name, v, spec_type, links):
    if v is None or v == "":
        return None
    if spec_type == URL:
        return {"link": str(v), "text": str(v)}
    if spec_type == DATE:
        d = datetime.strptime(str(v), "%Y-%m-%d").replace(tzinfo=timezone.utc)
        return int(d.timestamp() * 1000)
    if spec_type == NUMBER:
        return float(v)
    return str(v)


def push_bitable(tok, app_token, data):
    made = []
    for sheet, (head, rows) in data.items():
        cols = list(zip(*[v for v, _ in rows])) if rows else [()] * len(head)
        specs = [field_spec(h, cols[i]) for i, h in enumerate(head)]
        if sheet == "排查登记表":
            specs.append({"field_name": "处理状态", "type": SELECT,
                          "property": {"options": [{"name": o} for o in STATUS_OPTS]}})

        print(f"  建表「{sheet}」：{len(specs)} 字段 / {len(rows)} 行")
        if DRY:
            for s in specs:
                print(f"    - {s['field_name']:14} type={s['type']}")
            continue

        d = api("POST", f"/bitable/v1/apps/{app_token}/tables", tok,
                {"table": {"name": sheet, "fields": specs}})
        table_id = d["table_id"]

        records = []
        for vals, links in rows:
            f = {}
            for i, h in enumerate(head):
                cv = cell_value(h, vals[i], specs[i]["type"], links)
                if cv is not None:
                    f[h] = cv
            records.append({"fields": f})

        for i in range(0, len(records), 500):
            api("POST", f"/bitable/v1/apps/{app_token}/tables/{table_id}/records/batch_create",
                tok, {"records": records[i:i + 500]})
        made.append((sheet, table_id, len(records)))
    return made


def col_letter(n):
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def update_sheets(tok, ss_token, data):
    """原地更新：覆盖写入现有工作表，多余的旧行删掉，不删表重建。

    保留工作表本身及其上的筛选、格式、以及用户自行追加的列（追加列在
    数据区右侧，不会被本次写入覆盖）。
    """
    meta = api("GET", f"/sheets/v3/spreadsheets/{ss_token}/sheets/query", tok)
    cur = {s["title"]: (s["sheet_id"],
                        s.get("grid_properties", {}).get("row_count", 0),
                        s.get("grid_properties", {}).get("column_count", 0))
           for s in meta["sheets"]}

    made = []
    for sheet, (head, rows) in data.items():
        values = [head] + [[("" if v is None else v) for v in vals] for vals, _ in rows]
        need_rows, need_cols = len(values), len(head)

        if sheet not in cur:
            d = api("POST", f"/sheets/v2/spreadsheets/{ss_token}/sheets_batch_update", tok,
                    {"requests": [{"addSheet": {"properties": {"title": sheet}}}]})
            sid = d["replies"][0]["addSheet"]["properties"]["sheetId"]
            have_rows = have_cols = 0
            action = "新建"
        else:
            sid, have_rows, have_cols = cur[sheet]
            action = "更新"

        # 列不够先补，否则写入会越界
        if have_cols and need_cols > have_cols:
            api("POST", f"/sheets/v2/spreadsheets/{ss_token}/dimension_range", tok,
                {"dimension": {"sheetId": sid, "majorDimension": "COLUMNS",
                               "length": need_cols - have_cols}})

        api("PUT", f"/sheets/v2/spreadsheets/{ss_token}/values", tok,
            {"valueRange": {"range": f"{sid}!A1:{col_letter(need_cols)}{need_rows}",
                            "values": values}})

        # 这次数据比上次短，把尾部残留的旧行删掉
        removed = 0
        if have_rows > need_rows:
            api("DELETE", f"/sheets/v2/spreadsheets/{ss_token}/dimension_range", tok,
                {"dimension": {"sheetId": sid, "majorDimension": "ROWS",
                               "startIndex": need_rows + 1, "endIndex": have_rows}})
            removed = have_rows - need_rows

        print(f"  {action}「{sheet}」：{need_cols} 列 / {len(rows)} 行"
              + (f"，删除残留 {removed} 行" if removed else ""))
        made.append((sheet, sid, len(rows)))
    return made


YELLOW, WHITE = "#FFF2CC", "#FFFFFF"


def _merge_runs(nums):
    """把 [2,3,4,9,10] 合成 [(2,4),(9,10)]，减少 range 数量。"""
    runs = []
    for n in sorted(nums):
        if runs and n == runs[-1][1] + 1:
            runs[-1][1] = n
        else:
            runs.append([n, n])
    return [tuple(r) for r in runs]


def apply_lowprice_fill(tok, ss_token, xlsx_path=None):
    """低于官方指导价的，只给「违规售价」那一格刷浅黄，其余同列格子清白。"""
    wb = load_workbook(xlsx_path or XLSX)
    ws = wb["排查登记表"]
    head = [c.value for c in ws[1]]
    ip, ig = head.index("违规售价"), head.index("官方指导价")
    pc = col_letter(ip + 1)                      # 只作用于这一列

    hit, miss = [], []
    for i, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        p, g = row[ip], row[ig]
        (hit if isinstance(p, (int, float)) and isinstance(g, (int, float)) and p < g
         else miss).append(i)

    meta = api("GET", f"/sheets/v3/spreadsheets/{ss_token}/sheets/query", tok)
    sid = next(s["sheet_id"] for s in meta["sheets"] if s["title"] == "排查登记表")

    for rows, color in ((miss, WHITE), (hit, YELLOW)):
        ranges = [f"{sid}!{pc}{a}:{pc}{b}" for a, b in _merge_runs(rows)]
        for i in range(0, len(ranges), 50):          # 接口对 range 数量有上限
            api("PUT", f"/sheets/v2/spreadsheets/{ss_token}/styles_batch_update", tok,
                {"data": [{"ranges": ranges[i:i + 50], "style": {"backColor": color}}]})
    print(f"  {pc} 列：{len(hit)} 格刷浅黄，{len(miss)} 格清白")
    return len(hit)


def _hex(color, default=None):
    """openpyxl 的颜色是 AARRGGBB，转成飞书要的 #RRGGBB。"""
    rgb = getattr(color, "rgb", None)
    if not isinstance(rgb, str) or len(rgb) != 8 or rgb == "00000000":
        return default
    return "#" + rgb[2:]


def apply_dashboard_style(tok, ss_token, xlsx_path=None):
    """把 xlsx「看板」页的字体色/底色/字号原样刷到飞书，分组批量下发。"""
    wb = load_workbook(xlsx_path or XLSX)
    if "看板" not in wb.sheetnames:
        return 0
    ws = wb["看板"]
    meta = api("GET", f"/sheets/v3/spreadsheets/{ss_token}/sheets/query", tok)
    sid = next((s["sheet_id"] for s in meta["sheets"] if s["title"] == "看板"), None)
    if sid is None:
        return 0

    groups = {}
    for row in ws.iter_rows():
        for c in row:
            fore = _hex(c.font.color) if c.font and c.font.color else None
            back = _hex(c.fill.fgColor) if c.fill and c.fill.fgColor else None
            bold = bool(c.font and c.font.bold)
            size = int(c.font.size) if c.font and c.font.size else 10
            # 飞书 hAlign：0 左 / 1 中 / 2 右
            align = {"center": 1, "right": 2}.get(
                c.alignment.horizontal if c.alignment else None, 0)
            if not (fore or back or bold or size != 10 or align):
                continue
            key = (fore, back, bold, size, align)
            groups.setdefault(key, []).append(f"{sid}!{c.coordinate}:{c.coordinate}")

    for (fore, back, bold, size, align), ranges in groups.items():
        style = {"font": {"bold": bold, "fontSize": f"{size}pt/1.5"}, "hAlign": align}
        if fore:
            style["foreColor"] = fore
        if back:
            style["backColor"] = back
        for i in range(0, len(ranges), 50):
            api("PUT", f"/sheets/v2/spreadsheets/{ss_token}/styles_batch_update", tok,
                {"data": [{"ranges": ranges[i:i + 50], "style": style}]})
    print(f"  看板样式：{len(groups)} 组，共 {sum(len(v) for v in groups.values())} 格")
    return len(groups)


# openpyxl 的格式 → 飞书接受的格式（实测：0.00 / 0.0% 会返回 90204 invalid formatter）
FMT_MAP = {"0.00": "#,##0.00", "0.0%": "0.00%", "0.00%": "0.00%", "0": "0"}


def apply_number_formats(tok, ss_token, xlsx_path=None):
    """values 接口不带数字格式，百分比写过去会显示成 0.3548…，这里按列补上。

    只对整列格式一致的列下发，保留数值类型（飞书里仍可排序筛选）。
    """
    wb = load_workbook(xlsx_path or XLSX)
    meta = api("GET", f"/sheets/v3/spreadsheets/{ss_token}/sheets/query", tok)
    sid_of = {s["title"]: s["sheet_id"] for s in meta["sheets"]}

    done = 0
    for name in wb.sheetnames:
        if name not in sid_of or name == "看板":     # 看板的占比已写成字符串
            continue
        ws = wb[name]
        for col in range(1, ws.max_column + 1):
            fmts = {ws.cell(row=r, column=col).number_format
                    for r in range(2, min(ws.max_row, 40) + 1)}
            fmts.discard("General")
            if len(fmts) != 1:
                continue
            # 飞书只认自己那套写法：'0.00'/'0.0%' 会被拒（90204），得换成等价格式
            fmt = FMT_MAP.get(fmts.pop())
            if not fmt:
                continue
            cl = col_letter(col)
            api("PUT", f"/sheets/v2/spreadsheets/{ss_token}/styles_batch_update", tok,
                {"data": [{"ranges": [f"{sid_of[name]}!{cl}2:{cl}{ws.max_row}"],
                           "style": {"formatter": fmt}}]})
            done += 1
    print(f"  数字格式：{done} 列")
    return done


def push_sheets(tok, ss_token, data):
    made = []
    for sheet, (head, rows) in data.items():
        print(f"  写入「{sheet}」：{len(head)} 列 / {len(rows)} 行")
        if DRY:
            continue
        # 增加工作表只有 v2 有 sheets_batch_update，v3 没这个接口
        d = api("POST", f"/sheets/v2/spreadsheets/{ss_token}/sheets_batch_update", tok,
                {"requests": [{"addSheet": {"properties": {"title": sheet}}}]})
        sid = d["replies"][0]["addSheet"]["properties"]["sheetId"]
        values = [head] + [[("" if v is None else v) for v in vals] for vals, _ in rows]
        end = chr(ord("A") + len(head) - 1) if len(head) <= 26 else "Z"
        api("PUT", f"/sheets/v2/spreadsheets/{ss_token}/values", tok,
            {"valueRange": {"range": f"{sid}!A1:{end}{len(values)}", "values": values}})
        made.append((sheet, sid, len(rows)))
    return made


if __name__ == "__main__":
    data = load_data()
    print(f"本地数据：{', '.join(f'{k}({len(v[1])}行)' for k, v in data.items())}\n")

    if DRY:
        print("— dry-run，不调用飞书 —")
        push_bitable(None, None, data)
        raise SystemExit(0)

    for k in ("FEISHU_APP_ID", "FEISHU_APP_SECRET", "WIKI_TOKEN"):
        if not os.environ.get(k):
            raise SystemExit(f"缺环境变量 {k}")

    tok = auth()
    otype, otoken, title = resolve_wiki(tok, os.environ["WIKI_TOKEN"])
    print(f"目标文档：「{title}」类型={otype}\n")

    if otype == "bitable":
        made = push_bitable(tok, otoken, data)
    elif otype in ("sheet", "spreadsheet"):
        made = push_sheets(tok, otoken, data)
    else:
        raise SystemExit(f"✗ 该文档是 {otype}，不是多维表格或电子表格，没法写表。"
                         f"请换一个多维表格文档，或让我新建一个。")

    print("\n✓ 完成")
    for s, i, n in made:
        print(f"  {s:18} {i}  {n} 行")
