# -*- coding: utf-8 -*-
"""从 Ctrl+S 保存的淘宝搜索结果页中抽取商品卡片字段。"""

import json
import re
import sys
from urllib.parse import urlparse, parse_qs, unquote

from bs4 import BeautifulSoup


def _has(el, key):
    c = el.get("class") or []
    if isinstance(c, str):
        c = c.split()
    return any(k.startswith(key) for k in c)


def cls_get(card, key):
    for el in card.find_all(True):
        if _has(el, key):
            return el.get_text(strip=True)
    return ""


def parse(path):
    html = open(path, encoding="utf-8", errors="ignore").read()
    soup = BeautifulSoup(html, "lxml")
    out = []
    for card in soup.select("div.search-content-col"):
        item_href = shop_href = wrap_href = ""
        for a in card.find_all("a", href=True):
            h = a["href"]
            if "item.taobao.com" in h or "detail.tmall.com" in h:
                item_href = item_href or h
            elif "store.taobao.com" in h or "shop" in h and "taobao" in h:
                shop_href = shop_href or h
            elif "simba.taobao.com" in h:
                wrap_href = wrap_href or h

        shop = cls_get(card, "shopNameText")
        title = cls_get(card, "title")
        if not (shop or title):
            continue

        pi = cls_get(card, "priceInt")
        pf = cls_get(card, "priceFloat")
        price = (pi + pf).strip()

        # 广告位的 simba 链接里 s= 是投放位标识，全站同值，不是 sellerId —— 不能当卖家ID用
        seller_id = ""
        src = "广告" if any(h and "simba.taobao.com" in h
                          for h in (wrap_href, item_href, shop_href)) else "自然"
        ad_slot = ""
        for h in (wrap_href, item_href, shop_href):
            if h and "simba.taobao.com" in h:
                ad_slot = (parse_qs(urlparse(h).query).get("s") or [""])[0]
                break
        app_uid = ""
        if shop_href:
            q = parse_qs(urlparse(shop_href).query)
            app_uid = (q.get("appUid") or [""])[0]

        item_id = ""
        if item_href:
            q = parse_qs(urlparse(item_href.replace("&amp;", "&")).query)
            item_id = (q.get("id") or [""])[0]

        procity = [e.get_text(strip=True) for e in card.find_all(True)
                   if _has(e, "procity")]

        out.append({
            "shop": shop,
            "title": title,
            "price": price,
            "sales": cls_get(card, "realSales"),
            "item_id": item_id,
            "item_url": f"https://item.taobao.com/item.htm?id={item_id}" if item_id else "",
            "seller_id": seller_id,
            "app_uid": app_uid,
            "ad_slot": ad_slot,
            # 广告位卡片没有直链，但整卡包着的 simba 跳转链接点了能到商品页
            "ad_url": (wrap_href or shop_href or "").replace("&amp;", "&"),
            "src": src,
            "loc": " ".join(procity),
        })
    return out


if __name__ == "__main__":
    rows = []
    for p in sys.argv[1:]:
        rows += parse(p)
    print(json.dumps(rows, ensure_ascii=False, indent=1))
