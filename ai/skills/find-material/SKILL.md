---
name: find-material
description: Locate things inside this study folder, such as which file, slide or week covers a concept, where an assignment brief is, or what video link goes with a lecture. Use for "where is...", "which lecture covers...", "find the slide about...".
---

_Paths: `<sem>` = the current semester folder (named in STUDENT.md; otherwise the newest folder under `semesters/`)._

# Find material in the folder

1. `grep -ril "<term>" <sem>/text/` to find files mentioning it; then `grep -n -i -C2 "<term>" <file>` for context. Text files keep the course/week path of the original, e.g. `<sem>/text/COS514-.../05-.../COS514_WM-Lecture 4.pdf.txt` ↔ `<sem>/courses/COS514-.../05-.../COS514_WM-Lecture 4.pdf`.
2. For PPTX text, slide boundaries are marked `--- slide N ---`; for PDFs, pages are separated by form feeds (`\f`), so count them to give a page number.
3. Check `<sem>/courses/<course>/README.md` for videos and external links (they're not files), and `<sem>/_meta/eclass-meta.json` for forum posts.
4. Answer with exact paths plus the slide/page number and a one-line description of each hit, best match first.
