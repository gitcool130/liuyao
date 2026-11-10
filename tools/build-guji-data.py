#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把「六爻数据工坊」里的书籍原文与古籍卦例，转成本项目前端可直接读的 JSON。

来源（王哥本机，不入库）：
  D:/greensoft/六爻工坊-Windows/六爻数据工坊/古籍数据包.zip
       cases_yimao.json（易冒 215 例）、cases_zengshan.json（增删卜易 404 例）
  D:/greensoft/六爻工坊-Windows/六爻数据工坊/books/*.json
       7 本书全文（chapters: no/title/text）

产物（入库）：
  public/guji/cases/<key>.json   {book, cases:[{id,title,monthZhi,dayGZ,benGua,bianGua,question,text}]}
  public/guji/text/<key>.json    {book, chapters:[{no,title,text}]}
  public/guji/manifest.json      书籍清单（前端据此渲染下拉）

卦例只有卦名与变卦名、没有六爻爻值——前端按「卦名→六爻」+「本卦/变卦异位即动爻」
还原 toss，见 core/guji-lib.js 的 bitsFromName / tossFromNames。
"""
import json
import os
import re
import zipfile

SRC = r"D:/greensoft/六爻工坊-Windows/六爻数据工坊"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "guji")

# 工坊里的书名 → 展示名（带来源口径，避免与仓库内的回归集同名混淆）
CASE_BOOKS = {
    "cases_zengshan.json": ("zengshan-yuanwen", "增删卜易 · 原文卦例"),
    "cases_yimao.json": ("yimao-yuanwen", "易冒 · 原文卦例"),
}
TEXT_BOOKS = {
    "增删卜易": "zengshan",
    "卜筮正宗": "bushizhengzong",
    "卜筮全书": "bushiquanshu",
    "断易天机": "duanyitianji",
    "易冒": "yimao",
    "易林补遗": "yilinbuyi",
    "易隐": "yiyin",
    "火珠林": "huozhulin",
}


def norm_question(q):
    q = re.sub(r"\s+", " ", str(q or "")).strip()
    return q


def title_of(c):
    """标题：优先取原文里的「X月Y日」开头，没有就用问句前 40 字。"""
    q = norm_question(c.get("question"))
    t = norm_question(c.get("text"))
    m = re.search(r"^([^\s，,。]{0,4}月[^\s，,。]{0,4}日)", t)
    head = m.group(1) if m else ""
    base = q[:40] if q else (t[:40] if t else "")
    return (head + "　" + base).strip("　") if head else (base or "（无题）")


def build_cases():
    zpath = os.path.join(SRC, "古籍数据包.zip")
    if not os.path.exists(zpath):
        raise SystemExit("找不不到 " + zpath)
    made = []
    with zipfile.ZipFile(zpath) as z:
        for name in z.namelist():
            key, shown = CASE_BOOKS.get(name, (None, None))
            if not key:
                continue
            d = json.loads(z.read(name).decode("utf-8"))
            out = []
            for c in d.get("cases", []):
                day = c.get("dayGz") or c.get("dayGZ") or ""
                out.append({
                    "id": "%s-%04d" % (key, int(c.get("index") or len(out) + 1)),
                    "title": title_of(c),
                    "monthZhi": c.get("monthZhi") or "",
                    "dayGZ": day,
                    "benGua": c.get("benGua") or "",
                    "bianGua": c.get("bianGua") or "",
                    "question": norm_question(c.get("question")),
                    "text": c.get("text") or "",
                })
            os.makedirs(os.path.join(OUT, "cases"), exist_ok=True)
            p = os.path.join(OUT, "cases", key + ".json")
            with open(p, "w", encoding="utf-8") as f:
                json.dump({"book": shown, "cases": out}, f, ensure_ascii=False, separators=(",", ":"))
            made.append({"key": key, "name": shown, "kind": "cases", "count": len(out),
                         "file": "guji/cases/%s.json" % key})
            print("%-24s 例 %4d  %6.1f KB" % (shown, len(out), os.path.getsize(p) / 1024))
    return made


def build_texts():
    made = []
    bdir = os.path.join(SRC, "books")
    if not os.path.isdir(bdir):
        raise SystemExit("找不到 " + bdir)
    for fn in sorted(os.listdir(bdir)):
        if not fn.endswith(".json") or fn.startswith("_"):
            continue
        d = json.load(open(os.path.join(bdir, fn), encoding="utf-8"))
        book = d.get("book") or fn[:-5]
        key = TEXT_BOOKS.get(book)
        if not key:
            continue
        chs = [{"no": c.get("no"), "title": c.get("title") or "", "text": c.get("text") or ""}
               for c in d.get("chapters", [])]
        os.makedirs(os.path.join(OUT, "text"), exist_ok=True)
        p = os.path.join(OUT, "text", key + ".json")
        with open(p, "w", encoding="utf-8") as f:
            json.dump({"book": book, "chapters": chs}, f, ensure_ascii=False, separators=(",", ":"))
        made.append({"key": key, "name": book + " · 原文", "kind": "text", "count": len(chs),
                     "file": "guji/text/%s.json" % key})
        print("%-24s 章 %4d  %6.1f KB" % (book, len(chs), os.path.getsize(p) / 1024))
    return made


def build_duanyu():
    """仓库自带的 68 条「断语用例」（tests/guji/cases/）：卦例 + 原文断语 +
    预期规则断言（expect）。与 corpus 的 404 条是两套东西——corpus 是还原后的
    六爻数据，这里是把原文断语与规则链的判定绑在一起，用于对勘「引擎断得对不对」。
    数据源在仓库内，随仓库走，不进本脚本的敏感来源。"""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    made = []
    for f, key, name in [
        ("zengshan-boyi", "zengshan-duanyu", "增删卜易 · 断语用例"),
        ("bushi-zhengzong", "bushizhengzong-duanyu", "卜筮正宗 · 断语用例"),
    ]:
        p = os.path.join(root, "tests", "guji", "cases", f + ".json")
        if not os.path.exists(p):
            continue
        d = json.load(open(p, encoding="utf-8"))
        out = []
        for c in d.get("cases", []):
            out.append({
                "id": c.get("id"),
                "title": c.get("title") or "（无题）",
                "chapter": c.get("chapter") or "",
                "line": c.get("bookLine"),
                "monthZhi": c.get("monthZhi") or "",
                "dayGZ": c.get("dayGZ") or "",
                "toss": c.get("toss"),
                "quote": c.get("quote") or "",
                "note": c.get("note") or "",
                "expect": c.get("expect") or [],
                "date": c.get("date") or "",
            })
        os.makedirs(os.path.join(OUT, "cases"), exist_ok=True)
        fp = os.path.join(OUT, "cases", key + ".json")
        with open(fp, "w", encoding="utf-8") as f2:
            json.dump({"book": name, "cases": out}, f2, ensure_ascii=False, separators=(",", ":"))
        made.append({"key": key, "name": name, "kind": "duanyu", "count": len(out),
                     "file": "guji/cases/%s.json" % key})
        print("%-24s 例 %4d  %6.1f KB" % (name, len(out), os.path.getsize(fp) / 1024))
    return made


def main():
    os.makedirs(OUT, exist_ok=True)
    books = []
    # 仓库自带的断语回归集（六爻齐全、含规则断言）——直接复用 tests/guji/corpus
    root = os.path.dirname(OUT)
    for key, name, rel in [
        ("zengshan-boyi", "增删卜易 · 六爻卦例", "guji/zengshan-boyi.json"),
        ("bushi-zhengzong", "卜筮正宗 · 六爻卦例", "guji/bushi-zhengzong.json"),
    ]:
        src = os.path.join(OUT, os.path.basename(rel))
        if os.path.exists(src):
            n = len(json.load(open(src, encoding="utf-8")).get("cases", []))
            books.append({"key": key, "name": name, "kind": "corpus", "count": n, "file": rel})
            print("%-24s 例 %4d  （复用仓库回归集）" % (name, n))
    books += build_cases()
    books += build_duanyu()
    books += build_texts()
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"generated": True, "books": books}, f, ensure_ascii=False, indent=1)
    total = sum(b["count"] for b in books)
    print("\n清单写入 manifest.json：%d 本，条目合计 %d" % (len(books), total))


if __name__ == "__main__":
    main()
