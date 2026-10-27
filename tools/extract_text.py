#!/usr/bin/env python3
"""Mirror courses/ into text/ as searchable .txt files (PDF, PPTX, DOCX, IPYNB).
Slides are marked "--- slide N ---" and PDF pages "--- page N ---", so notes can cite where a point is.
Only (re)processes files that are new or changed. Usage: python3 tools/extract_text.py [2026-Fall]"""
import json, re, subprocess, sys, zipfile, shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

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

def paged(pages):
    """A PDF's pages with a "--- page N ---" line on top of each, still split by form feeds (search reads those)."""
    return "\f".join(f"--- page {i} ---\n\n{t}" for i, t in enumerate(pages, 1))

def pdf(p):
    if shutil.which("pdftotext"):
        out = subprocess.run(["pdftotext", "-layout", str(p), "-"], capture_output=True, text=True, errors="ignore").stdout
        pages = out.split("\f")
        return paged(pages[:-1] if len(pages) > 1 and not pages[-1].strip() else pages)   # pdftotext ends with a form feed
    try:
        from pypdf import PdfReader
        return paged([pg.extract_text() or "" for pg in PdfReader(str(p)).pages])
    except ImportError:
        sys.exit("Need pdftotext (brew install poppler) or pypdf (pip install pypdf)")

def stale(src, out):
    """True when the text copy is missing, older than its file, or a PDF's copy from before page markers."""
    src, out = Path(src), Path(out)
    if not out.exists() or out.stat().st_mtime < src.stat().st_mtime: return True
    if src.suffix.lower() != ".pdf": return False
    with open(out, encoding="utf8", errors="ignore") as f:
        return not f.read(32).startswith("--- page 1 ---")

H = {".pdf": pdf, ".pptx": pptx, ".docx": docx, ".ipynb": ipynb}

def main():
    sem = ROOT / "semesters" / (sys.argv[1] if len(sys.argv) > 1 else "2026-Fall")
    src, dst = sem / "courses", sem / "text"
    n = 0
    for f in src.rglob("*"):
        if f.suffix.lower() not in H: continue
        out = dst / f.relative_to(src).with_name(f.name + ".txt")
        if not stale(f, out): continue
        out.parent.mkdir(parents=True, exist_ok=True)
        try:
            out.write_text(H[f.suffix.lower()](f)); n += 1
        except Exception as e:
            print("failed:", f, e)
    print(f"extracted text from {n} files")

if __name__ == "__main__":
    main()
