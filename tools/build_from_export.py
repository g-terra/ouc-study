#!/usr/bin/env python3
"""Build/refresh the study folder from an eClass export zip.
Usage: python3 tools/build_from_export.py <export.zip> [<semester e.g. 2026-Fall>]  (then run: npm run content)
The zip holds <CODE>/<NN>/<file> plus _meta.json (scraped course structure)."""
import json, re, sys, zipfile, shutil, os
from datetime import datetime
from pathlib import Path

ZIP = Path(sys.argv[1]); ROOT = Path(__file__).resolve().parents[1] / "semesters" / (sys.argv[2] if len(sys.argv) > 2 else "2026-Fall")  # semester folder
NAMES = {"COS511": "COS511-Cognitive-Psychology", "COS512": "COS512-Artificial-Intelligence", "COS514": "COS514-Computational-Neuroscience"}
EMOJI = {"resource": "📄", "assign": "📝", "page": "🎬", "url": "🔗", "forum": "💬", "lti": "🖥️", "label": "ℹ️"}

def slug(s, n=60):
    s = re.sub(r"[^\w\s.-]", "", s, flags=re.U).strip()
    return re.sub(r"\s+", "-", s)[:n].strip("-") or "section"

z = zipfile.ZipFile(ZIP)
meta = json.loads(z.read("_meta.json"))
(ROOT / "_meta").mkdir(parents=True, exist_ok=True)
(ROOT / "_meta" / "eclass-meta.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False))

def secdir(code, s):
    return ROOT / "courses" / NAMES[code] / f"{s['i']:02d}-{slug(s['name'])}"

# 1. extract files into course/section folders
secmap = {}
for c in meta:
    for s in c["secs"]:
        secmap[(c["code"], f"{s['i']:02d}")] = secdir(c["code"], s)
count = 0
for info in z.infolist():
    if info.filename == "_meta.json" or info.is_dir():
        continue
    code, nn, rest = info.filename.split("/", 2)
    dest = secmap[(code, nn)] / rest
    dest.parent.mkdir(parents=True, exist_ok=True)
    with z.open(info) as src, open(dest, "wb") as out:
        shutil.copyfileobj(src, out)
    count += 1

def rel(code, s, local):
    return f"{s['i']:02d}-{slug(s['name'])}/{local.split('/', 2)[2]}".replace(" ", "%20")

# 2. course READMEs (week maps)
deadlines = []
for c in meta:
    code = c["code"]; cdir = ROOT / "courses" / NAMES[code]; cdir.mkdir(parents=True, exist_ok=True)
    L = [f"# {c['title']}", "", f"eClass: https://eclass.ouc.ac.cy/course/view.php?id={c['id']}  ", f"Imported: {datetime.now():%Y-%m-%d}", "",
         "Legend: 📄 file · 📝 assignment · 🎬 video page · 🔗 external link · 💬 forum · 🖥️ live session/tool", ""]
    for s in c["secs"]:
        L.append(f"## {s['i']:02d}. {s['name']}")
        if s.get("summary"):
            summ = re.sub(r"\s+", " ", s["summary"])[:500]
            L.append("> " + summ)
        L.append("")
        for a in s["acts"]:
            t = a.get("type"); name = a.get("name") or ""
            if t == "label" and not name:
                continue
            e = EMOJI.get(t, "•")
            if t == "resource" and a.get("local"):
                L.append(f"- {e} [{name}]({rel(code, s, a['local'])})")
            elif t == "resource":
                L.append(f"- {e} {name} (not downloaded: {a.get('file','')}, link: {a.get('url')})")
            elif t == "assign":
                due = next((d for d in a.get("dates", []) if d.startswith("Due")), "")
                st = next((x for x in a.get("status", []) if x.startswith("Submission status")), "").replace("Submission status ", "")
                L.append(f"- {e} **{name}**: {due}; _{st}_ ([eClass]({a.get('url')}))")
                for lf in a.get("localfiles", []) or []:
                    L.append(f"    - brief: [{lf.split('/')[-1]}]({rel(code, s, lf)})")
                body = re.sub(r"\s+", " ", a.get("body") or "").strip()
                if body:
                    L.append(f"    - {body[:600]}{'…' if len(body) > 600 else ''}")
                if due:
                    deadlines.append((code, name, due.replace("Due: ", ""), st, a.get("url")))
            elif t == "page":
                vids = [l for l in a.get("links", []) if re.search(r"youtu|vimeo|panopto|stream|video|kaltura|player", l, re.I)] or a.get("links", [])[:3]
                L.append(f"- {e} {name}: " + (" · ".join(f"[link]({v})" for v in vids[:3]) if vids else f"[eClass]({a.get('url')})"))
            elif t == "url":
                L.append(f"- {e} [{name}]({a.get('target') or a.get('url')})")
            elif t == "forum":
                L.append(f"- {e} [{name}]({a.get('url')}) ({len(a.get('threads', []))} threads, saved in _meta/eclass-meta.json)")
            else:
                L.append(f"- {e} {name}" + (f" ([open]({a['url']}))" if a.get("url") else ""))
        L.append("")
    (cdir / "README.md").write_text("\n".join(L))

# 3. DEADLINES.md
def parse(d):
    try: return datetime.strptime(re.sub(r"^\w+, ", "", d), "%d %B %Y, %I:%M %p")
    except Exception: return datetime.max
deadlines.sort(key=lambda x: parse(x[2]))
now = datetime.now()
D = ["# Deadlines", "", f"_From eClass on {now:%Y-%m-%d}. Times as shown on eClass. Update the Status column when you submit._", "",
     "| Due | Days left | Course | Item | Status |", "|---|---|---|---|---|"]
for code, name, due, st, url in deadlines:
    dt = parse(due); left = (dt - now).days if dt != datetime.max else ""
    done = "✅ " if "Submitted" in st else ("⚠️ " if isinstance(left, int) and 0 <= left <= 7 else "")
    D.append(f"| {due} | {left if not isinstance(left,int) or left >= 0 else 'past'} | {code} | [{name}]({url}) | {done}{st} |")
(ROOT / "DEADLINES.md").write_text("\n".join(D) + "\n")
print(f"extracted {count} files; {len(deadlines)} deadlines")
