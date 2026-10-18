#!/usr/bin/env python3
"""Mirror courses/ into text/ as searchable .txt files (PDF, PPTX, DOCX, IPYNB).
Only (re)processes files that are new or changed. Usage: python3 tools/extract_text.py [2026-Fall]"""
import json, re, subprocess, sys, zipfile, shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEM = ROOT / "semesters" / (sys.argv[1] if len(sys.argv) > 1 else "2026-Fall")
SRC, DST = SEM / "courses", SEM / "text"

def xml_text(x):
    x = re.sub(r"</a:p>|</w:p>", "\n", x)
    return re.sub(r"<[^>]+>", "", x).replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&apos;", "'")

def pptx(p):
    z = zipfile.ZipFile(p); out = []
    slides = sorted((n for n in z.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", n)), key=lambda n: int(re.findall(r"\d+", n)[-1]))
    for n in slides:
        k = re.findall(r"\d+", n)[-1]
        out.append(f"--- slide {k} ---\n" + xml_text(z.read(n).decode("utf8", "ignore")).strip())
        nn = f"ppt/notesSlides/notesSlide{k}.xml"
        if nn in z.namelist():
            t = xml_text(z.read(nn).decode("utf8", "ignore")).strip()
            if t: out.append("[speaker notes]\n" + t)
    return "\n\n".join(out)

def docx(p):
    return xml_text(zipfile.ZipFile(p).read("word/document.xml").decode("utf8", "ignore"))

def ipynb(p):
    nb = json.loads(Path(p).read_text(encoding="utf8", errors="ignore"))
    return "\n\n".join(f"### [{c.get('cell_type')}]\n" + "".join(c.get("source", [])) for c in nb.get("cells", []))

def pdf(p):
    if shutil.which("pdftotext"):
        return subprocess.run(["pdftotext", "-layout", str(p), "-"], capture_output=True, text=True, errors="ignore").stdout
    try:
        from pypdf import PdfReader
        return "\f".join((pg.extract_text() or "") for pg in PdfReader(str(p)).pages)
    except ImportError:
        sys.exit("Need pdftotext (brew install poppler) or pypdf (pip install pypdf)")

H = {".pdf": pdf, ".pptx": pptx, ".docx": docx, ".ipynb": ipynb}
n = 0
for f in SRC.rglob("*"):
    if f.suffix.lower() not in H: continue
    out = DST / f.relative_to(SRC).with_name(f.name + ".txt")
    if out.exists() and out.stat().st_mtime >= f.stat().st_mtime: continue
    out.parent.mkdir(parents=True, exist_ok=True)
    try:
        out.write_text(H[f.suffix.lower()](f)); n += 1
    except Exception as e:
        print("failed:", f, e)
print(f"extracted text from {n} files")
