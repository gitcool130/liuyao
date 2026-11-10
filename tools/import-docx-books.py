#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把王哥整理的三本 docx 转成本项目的古籍书籍 / 卦例 JSON。

来源（本机，不入库）：
  F:/OneDrive/无影阅读/当下读书/近期素材/
    独门易卦秘典--修正玄雅轩版.docx       → 全文书（按「卷」分章）
    《独门易卦秘典》六爻卦例全解(含目录).docx → 卦例书（144 例，四列版式可直接解析）
    修订版讲义2026最新（1106纠错版）.docx   → 全文书（按「章」分章）

产物（public/guji/ 下，已被 .gitignore 排除）：
  text/dumen-midian.json     {book, chapters:[{no,title,text}]}
  text/jiangyi-2026.json     {book, chapters:[...]}
  cases/dumen-quanjie.json   {book, cases:[{id,title,monthZhi,dayGZ,benGua,bianGua,toss,raw6,text}]}

卦例解析要点：正文版式与咱们桌面版的「古籍版式」一致——
  干支： 癸丑年  戌月  丁亥日　(旬空：午未)
  　　　　　　　　　艮宫：山天大畜 　　　　　艮宫：山火贲(六合)
  六神　 伏　　神　【本　　卦】 　　　　　　　【变　　卦】
  青龙　　　　　　　官鬼丙寅木━━━ 　　　　官鬼丙寅木━━━
爻符 ━━━ = 阳、━　━ = 阴；○ / × = 动爻（阴阳不同标记），据此直接得爻值。
"""
import json
import os
import re
import zipfile
from xml.etree import ElementTree as ET

SRC = r"F:/OneDrive/无影阅读/当下读书/近期素材"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "guji")
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

ZHI = "子丑寅卯辰巳午未申酉戌亥"
GAN = "甲乙丙丁戊己庚辛壬癸"


def paras(path):
    root = ET.fromstring(zipfile.ZipFile(path).read("word/document.xml"))
    out = []
    for p in root.iter(W + "p"):
        txt = "".join(t.text or "" for t in p.iter(W + "t"))
        txt = txt.replace("\u00a0", " ").rstrip()
        if txt.strip():
            out.append(txt)
    return out


def dedupe_toc(lines, marker_re):
    """目录与正文都出现同一标题：取最后一次出现的位置切正文。"""
    idx = [i for i, s in enumerate(lines) if marker_re.match(s)]
    return idx


# ---------------- 全文书 ----------------

def build_book(path, key, name, head_re, strip_no=True):
    lines = paras(path)
    hits = [i for i, s in enumerate(lines) if head_re.match(s.strip())]
    if not hits:
        raise SystemExit("没找到章节标题：" + path)
    # 目录在前、正文在后：以「最后一个目录页」为界
    # 简化策略：若同一标题出现两次以上，从第二次开始算正文
    half = len(hits) // 2
    body_start = hits[half] if len(hits) >= 4 and hits[half] < len(lines) * 0.6 else hits[0]
    body = lines[body_start:]

    chapters, cur = [], None
    for s in body:
        t = s.strip()
        if head_re.match(t):
            if cur:
                chapters.append(cur)
            cur = {"no": len(chapters) + 1, "title": t, "text": ""}
        elif cur:
            cur["text"] += (t + "\n")
    if cur:
        chapters.append(cur)
    for c in chapters:
        c["text"] = c["text"].strip()
    chapters = [c for c in chapters if len(c["text"]) > 30]
    for i, c in enumerate(chapters, 1):
        c["no"] = i
    os.makedirs(os.path.join(OUT, "text"), exist_ok=True)
    fp = os.path.join(OUT, "text", key + ".json")
    with open(fp, "w", encoding="utf-8") as f:
        json.dump({"book": name, "chapters": chapters}, f, ensure_ascii=False, separators=(",", ":"))
    print("%-28s 章 %3d  %6.1f KB" % (name, len(chapters), os.path.getsize(fp) / 1024))
    return {"key": key, "name": name, "kind": "text", "count": len(chapters),
            "file": "guji/text/%s.json" % key}


# ---------------- 卦例 ----------------

CASE_RE = re.compile(r"^例[一二三四五六七八九十百零〇]+[、．.]")
SHEN = "青龙|朱雀|勾陈|螣蛇|白虎|玄武"


def parse_month_zhi(gz_line):
    """月建：多数书只写月支一个字（戌月），也有写全干支的（戊戌月）——
    统一取「月」字前面那个字即可。"""
    for m in re.finditer(r"(\S)月", gz_line):
        z = m.group(1)
        if z in ZHI:
            return ZHI.find(z)
    return None


def parse_day(gz_line):
    m = re.search(r"(\S{2})日", gz_line)
    if not m:
        return None
    gz = m.group(1)
    g, z = GAN.find(gz[0]), ZHI.find(gz[1])
    if g < 0 or z < 0:
        return None, None
    for i in range(60):
        if i % 10 == g and i % 12 == z:
            return i, gz
    return None, gz


def parse_gua_names(line):
    """宫名行：『艮宫：山天大畜 　　　　艮宫：山火贲(六合)』→ [本卦名, 变卦名]"""
    hits = re.findall(r"([^\s：]+)宫：([^\s（(]+)", line)
    names = [h[1] for h in hits]
    return (names[0] if names else None, names[1] if len(names) > 1 else None)


def parse_yao_line(line):
    """解析一爻：返回 {shen, fu, lq, gz, yang, moving, shi, ying, bian}"""
    s = line
    m = re.match(r"^(%s)" % SHEN, s)
    if not m:
        return None
    shen = m.group(1)
    rest = s[m.end():]
    moving = ("○" in rest) or ("×" in rest) or ("✕" in rest)
    shi = ("世" in rest)
    ying = ("应" in rest)
    # 爻符：一行里既有本卦爻符又有变卦爻符（变爻阴阳与本爻相反），
    # 不能简单地「包含 ━━━ 就算阳」，必须取**最先出现**的那一个
    cands = []
    for pat, val in (("━━━", True), ("━　━", False), ("━ ━", False), ("━━　━━", False)):
        i = rest.find(pat)
        if i >= 0:
            cands.append((i, val))
    if not cands:
        return None
    yang = sorted(cands)[0][1]
    # 段：按空白切，找带「六亲+干支+五行」的片段
    seg = re.split(r"\s+", rest.strip())
    tok_lq = re.findall(r"(父母|兄弟|子孙|妻财|官鬼)([%s])([%s])([木火土金水])" % (GAN, ZHI), rest)
    lq = None
    fu = None
    if tok_lq:
        lq = tok_lq[0]
        if len(tok_lq) > 1:
            fu = tok_lq[1]      # 第一个是伏神（排在前面），第二个是本爻
            lq = tok_lq[1]
            fu = tok_lq[0]
        else:
            fu = None
    else:
        return None
    del seg
    return {
        "shen": shen, "yang": yang, "moving": moving, "shi": shi, "ying": ying,
        "lq": lq[0], "gz": lq[1] + lq[2], "wx": lq[3],
        "fu": (fu[0] + fu[1] + fu[2] + fu[3]) if fu else "",
    }


def build_cases(path, key, name):
    lines = paras(path)
    starts = [i for i, s in enumerate(lines) if CASE_RE.match(s.strip())]
    # 去掉目录部分：只保留「干支行紧随其后」的那些
    real = []
    for i in starts:
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        if nxt.strip().startswith("干支"):
            real.append(i)
    cases = []
    for k, i in enumerate(real):
        end = real[k + 1] if k + 1 < len(real) else min(len(lines), i + 200)
        block = [s.strip() for s in lines[i:end]]
        title = block[0]
        gz_line = block[1]
        gua_line = block[2] if len(block) > 2 else ""
        ben, bian = parse_gua_names(gua_line)
        mz = parse_month_zhi(gz_line)
        day_idx, day_gz = parse_day(gz_line)

        # 六爻：从「六神」表头之后连续 6 行
        yao = []
        body_start = None
        for j, s in enumerate(block):
            if s.startswith("六神"):
                body_start = j + 1
                break
        if body_start:
            for s in block[body_start:body_start + 6]:
                v = parse_yao_line(s)
                if v:
                    yao.append(v)
        if len(yao) != 6:
            yao = []          # 解析不全就不给 toss，避免错盘
        toss = None
        if yao:
            # 版式是「上爻在前、初爻在后」，而 toss 约定自下而上（初→上），必须反转
            vals = []
            for v in reversed(yao):
                if v["yang"]:
                    vals.append(9 if v["moving"] else 1)
                else:
                    vals.append(6 if v["moving"] else 0)
            toss = vals

        # 断语：六爻之后到下一个「例」
        text_start = (body_start + 6) if body_start else 3
        concl = "\n".join(block[text_start:]).strip()

        cases.append({
            "id": "%s-%03d" % (key, len(cases) + 1),
            "title": re.sub(r"^例[一二三四五六七八九十百零〇]+[、．.]\s*", "", title),
            "chapter": "",
            "monthZhi": ZHI[mz] if mz is not None else "",
            "dayGZ": day_gz or "",
            "benGua": ben or "",
            "bianGua": bian or "",
            "toss": toss,
            "raw6": [s for s in block[(body_start or 3):(body_start or 3) + 6]],
            "text": concl,
        })
    os.makedirs(os.path.join(OUT, "cases"), exist_ok=True)
    fp = os.path.join(OUT, "cases", key + ".json")
    with open(fp, "w", encoding="utf-8") as f:
        json.dump({"book": name, "cases": cases}, f, ensure_ascii=False, separators=(",", ":"))
    good = sum(1 for c in cases if c["toss"])
    print("%-28s 例 %3d（六爻解析成功 %d）  %6.1f KB" % (name, len(cases), good, os.path.getsize(fp) / 1024))
    return {"key": key, "name": name, "kind": "cases", "count": len(cases),
            "file": "guji/cases/%s.json" % key}


def main():
    books = []
    books.append(build_book(os.path.join(SRC, "独门易卦秘典--修正玄雅轩版.docx"),
                            "dumen-midian", "独门易卦秘典 · 原文",
                            re.compile(r"^卷[一二三四五六七八九十]+")))
    books.append(build_book(os.path.join(SRC, "修订版讲义2026最新（1106纠错版）.docx"),
                            "jiangyi-2026", "六爻讲义2026 · 原文",
                            re.compile(r"^第[一二三四五六七八九十百]+章")))
    books.append(build_cases(os.path.join(SRC, "《独门易卦秘典》六爻卦例全解(含目录).docx"),
                             "dumen-quanjie", "独门易卦秘典 · 卦例全解"))

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
