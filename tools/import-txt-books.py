#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把纯文本古籍（txt）转成本项目的书籍 / 卦例 JSON。

来源（本机，不入库）：
  E:/读书及相关/命理/六爻/黎光/六爻三大技法-黎光.txt

这本书是 PDF → txt，格式有损（页码混进行内、部分卦名行被截断），所以：
  · 书籍正文按「三大技法」四段切（前言·总论 / 吉凶占 / 得失占 / 应期占），
    不去猜小节标题——目录标题在正文里只有 23/40 能对上，硬切反而切碎。
  · 卦例靠「宫名行（X宫：卦名）+ 干支行（辰月戊申日）」两处取数，
    实测 145 例里 139 例两样齐全；六爻爻值由卦名反推（本卦 vs 变卦逐位比对）。

产物：
  text/liguang-sandafa.json
  cases/liguang-sandafa.json
"""
import json
import os
import re

SRC = r"E:/读书及相关/命理/六爻/黎光/六爻三大技法-黎光.txt"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "guji")

ZHI = "子丑寅卯辰巳午未申酉戌亥"
GAN = "甲乙丙丁戊己庚辛壬癸"
CASE_RE = re.compile(r"^例[一二三四五六七八九十百]+$")
GZ_RE = re.compile(r"^(\S{1,2})月(\S{2})日")
GONG_RE = re.compile(r"([\u4e00-\u9fa5]{1,2})宫：([\u4e00-\u9fa5]{2,6})")
QIAN_GUA_RE = re.compile(r"【([^】]{2,6})】卦")


def load():
    lines = [l.strip() for l in open(SRC, encoding="utf-8").read().splitlines() if l.strip()]
    dots = [i for i, l in enumerate(lines) if re.search(r"[.．]{3,}", l)]
    body_start = dots[-1] + 1 if dots else 0
    return lines[:body_start], lines[body_start:]


def build_book(head, body):
    """按「第X大技法」切四段。"""
    marks = [i for i, l in enumerate(body) if re.match(r"^第[一二三]大技法", l)]
    segs = []
    if marks:
        if marks[0] > 0:
            segs.append(("前言 · 总论", body[:marks[0]]))
        for k, i in enumerate(marks):
            end = marks[k + 1] if k + 1 < len(marks) else len(body)
            segs.append((body[i].strip(), body[i + 1:end]))
    if not segs:
        segs = [("全文", body)]
    chapters = []
    for t, ls in segs:
        txt = "\n".join(ls).strip()
        if len(txt) < 50:
            continue
        chapters.append({"no": len(chapters) + 1, "title": t, "text": txt})
    os.makedirs(os.path.join(OUT, "text"), exist_ok=True)
    fp = os.path.join(OUT, "text", "liguang-sandafa.json")
    with open(fp, "w", encoding="utf-8") as f:
        json.dump({"book": "六爻三大技法 · 黎光", "chapters": chapters}, f, ensure_ascii=False, separators=(",", ":"))
    print("%-26s 章 %3d  %6.1f KB" % ("六爻三大技法 · 黎光", len(chapters), os.path.getsize(fp) / 1024))
    return {"key": "liguang-sandafa", "name": "六爻三大技法 · 黎光", "kind": "text",
            "count": len(chapters), "file": "guji/text/liguang-sandafa.json"}


NOISE = re.compile(r"^(第?\s*\d{1,3}\s*|[▅\s]+.*|【.*|.*宫：.*|摇得.*|性别.*|.*起卦方式.*)$")


def build_cases(body):
    idx = [i for i, l in enumerate(body) if CASE_RE.match(l)]
    cases = []
    for k, i in enumerate(idx):
        end = idx[k + 1] if k + 1 < len(idx) else len(body)
        blk = body[i:end]
        head = blk[:12]
        # 月建 / 日辰
        mz = day = ""
        for l in head:
            m = GZ_RE.match(l)
            if m:
                z = m.group(1)[-1]
                if z in ZHI:
                    mz = z
                day = m.group(2)
                break
        # 卦名：优先【X】卦 化 【Y】卦，其次宫名行
        names = [x for l in head for x in QIAN_GUA_RE.findall(l)]
        gongs = [g[1] for l in head for g in GONG_RE.findall(l)]
        ben = names[0] if names else (gongs[0] if gongs else "")
        bian = names[1] if len(names) > 1 else (gongs[1] if len(gongs) > 1 else "")
        if bian == ben:
            bian = ""
        # 事由
        title = ""
        for l in head:
            m = re.search(r"所占事情[:：]\s*(\S.*)$", l)
            if m:
                title = m.group(1).strip()
                break
        if not title:
            title = (blk[0] + (("　" + ben) if ben else "")).strip()
        # 断语：剔掉爻符/表头/宫名/摇得/性别/干支/页码
        body_lines = []
        for l in blk[1:]:
            if "▅" in l or "【" in l or "宫：" in l or "摇得" in l or "本  卦" in l or "变  卦" in l:
                continue
            if l.startswith("性别") or GZ_RE.match(l) or "起卦方式" in l:
                continue
            if re.fullmatch(r"\d{1,3}", l):
                continue
            body_lines.append(l)
        text = "\n".join(body_lines).strip()
        cases.append({
            "id": "liguang-%03d" % (len(cases) + 1),
            "title": title[:80],
            "chapter": "",
            "monthZhi": mz,
            "dayGZ": day,
            "benGua": ben,
            "bianGua": bian,
            "toss": None,
            "raw6": [],
            "text": text,
        })
    good = sum(1 for c in cases if c["benGua"] and c["monthZhi"] and c["dayGZ"])
    os.makedirs(os.path.join(OUT, "cases"), exist_ok=True)
    fp = os.path.join(OUT, "cases", "liguang-sandafa.json")
    with open(fp, "w", encoding="utf-8") as f:
        json.dump({"book": "六爻三大技法 · 卦例", "cases": cases}, f, ensure_ascii=False, separators=(",", ":"))
    print("%-26s 例 %3d（月日卦名齐全 %d）  %6.1f KB" %
          ("六爻三大技法 · 卦例", len(cases), good, os.path.getsize(fp) / 1024))
    return {"key": "liguang-sandafa", "name": "六爻三大技法 · 卦例", "kind": "cases",
            "count": len(cases), "file": "guji/cases/liguang-sandafa.json"}


def main():
    head, body = load()
    books = [build_book(head, body), build_cases(body)]
    mf = os.path.join(OUT, "manifest.json")
    old = {"books": []}
    if os.path.exists(mf):
        old = json.load(open(mf, encoding="utf-8"))
    keys = {b["key"] for b in books}
    merged = [b for b in old.get("books", []) if b["key"] not in keys] + books
    with open(mf, "w", encoding="utf-8") as f:
        json.dump({"generated": True, "books": merged}, f, ensure_ascii=False, indent=1)
    print("\nmanifest: %d 本，条目合计 %d" % (len(merged), sum(b["count"] for b in merged)))


if __name__ == "__main__":
    main()
