# -*- coding: utf-8 -*-
"""从 Ctrl+S 保存的京东搜索结果页中抽取商品卡片，输出与淘宝解析器同构的行。

京东新版搜索页用 CSS Module 哈希类名，但同一批次保存的页面哈希一致；
店铺名/标题优先从 chat.jd.com 客服链接的 query 参数取，比类名稳。
"""

import json
import re
import sys
from urllib.parse import urlparse, parse_qs, unquote

from bs4 import BeautifulSoup

PREFIX = {
    "title": "_goods_title_container_",
    "price": "_price_",
    "gray": "_gray_",
    "sales": "_goods_volume_",
    "shop": "_name_",
    "tags": "_tags_",
}


def _first(card, prefix):
    for x in card.find_all(True):
        for c in (x.get("class") or []):
            if c.startswith(prefix):
                return x.get_text(strip=True)
    return ""


def _num(text):
    m = re.search(r"(\d+(?:\.\d+)?)", (text or "").replace(",", ""))
    return m.group(1) if m else ""


def parse(path):
    soup = BeautifulSoup(open(path, encoding="utf-8", errors="ignore").read(), "lxml")
    out = []
    for card in soup.select("[data-sku]"):
        sku = card.get("data-sku", "")

        chat = {}
        for a in card.find_all("a", href=True):
            if "chat.jd.com" in a["href"]:
                chat = {k: v[0] for k, v in
                        parse_qs(urlparse(unquote(a["href"])).query).items()}
                break

        shop = chat.get("seller") or _first(card, PREFIX["shop"])
        title = _first(card, PREFIX["title"]) or chat.get("wname", "")
        if not (shop or title):
            continue

        price = _num(_first(card, PREFIX["price"]))
        listed = _num(_first(card, PREFIX["gray"]))          # 划线价/标价
        tags = _first(card, PREFIX["tags"])

        out.append({
            "platform": "京东",
            "shop": shop,
            "title": title,
            "price": price,
            "listed_price": listed,
            "sales": _first(card, PREFIX["sales"]),
            "item_id": sku,
            "item_url": f"https://item.jd.com/{sku}.html" if sku else "",
            "seller_id": "",          # 京东搜索页不暴露 venderId
            "app_uid": "",
            "src": "自然",
            "loc": "",                # 京东搜索页无发货地
            "tags": tags,
            "stock": chat.get("stock", ""),
            "comment_num": chat.get("commentNum", ""),
        })
    return out


if __name__ == "__main__":
    rows = []
    for p in sys.argv[1:]:
        rows += parse(p)
    print(json.dumps(rows, ensure_ascii=False, indent=1))
