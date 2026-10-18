---
name: sync-eclass
description: Re-sync this folder with OUC eClass: new or changed files, assignments, due dates, grades, feedback and forum posts. Updates <sem>/courses/, <sem>/assignments/, the daily update feed and the app data. Use when the student says "sync", "update from eClass", "anything new on eClass?", or wants to add a course or a new semester.
---

_Paths: `<sem>` = the current semester folder (named in STUDENT.md; otherwise the newest folder under `semesters/`)._

# Sync with eClass

Everything goes through the eClass web-service API with the student's own key (`.eclass-token`). **Never print, copy or read that file's contents.**

| Want | Run |
|---|---|
| What changed (grades, feedback, deadlines, announcements) + new files | `bash bin/ouc sync` |
| Only download new course files (and list them first) | `bash bin/ouc pull --dry-run`, then `bash bin/ouc pull` |
| Add a course or start a new semester | ask the student to run `ouc setup` in Terminal (it is interactive) |
| Key missing / expired (`updates/connection.json` state `nokey`, `invalid`) | ask the student to run `ouc setup`; it walks them through creating a key |

After a sync:
1. Read `<sem>/updates/<today>.json` (and `status.json` for errors).
2. If new files arrived, run `python3 tools/extract_text.py <semester-id>` so they are searchable in `<sem>/text/`.
3. Tell the student what's new in 3-6 bullets, any deadline in the next 14 days first, and offer notes for new lectures.
4. Append a one-line summary to `memory/learning-log.md`.

`pull` never overwrites or deletes files. A newer version of an existing file is saved next to it as `name (updated YYYY-MM-DD).ext`; mention these so the student can compare.

## No key? Browser fallback

Only if the student can't create a key: use a browser where they are signed in to https://eclass.ouc.ac.cy (never type their password; if you see the login page ask them to use "Office365 Login"), read the course pages, and save new files into `<sem>/courses/<course-dir>/NN-<section>/` following `<sem>/_meta/eclass-meta.json`.

## New semester
`ouc setup` creates `semesters/<YEAR>-<Fall|Spring>/` with its `semester.json`, downloads everything and builds the app. Afterwards, update `STUDENT.md` ("Current semester folder") and move `memory/progress.md` to `memory/archive/<old-sem>-progress.md` before starting a fresh one.
