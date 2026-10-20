---
name: important-dates
description: Add, change or remove a course's important dates (exams, presentations, anything with a day and maybe a time, with the topics it covers) in <sem>/_meta/dates.json, which the app shows on the Calendar, Today and the course's Dates tab. Use for "add my exam date", "the final moved to…", "remove the lab test", "what dates do I have for COS512".
---

_Paths: `<sem>` = the current semester folder (named in STUDENT.md; otherwise the newest folder under `semesters/`)._

# Important dates

The student keeps exam dates and other important dates by hand: eClass doesn't publish them in a form the app can read, so **only add dates the student gives you** (or that they point you to and confirm). Never guess a date, and don't read dates out of the exam timetable PDF on your own.

## The file

`<sem>/_meta/dates.json` (the app's course page, **Dates** tab, edits the same file):

```json
{
 "dates": [
  { "id": "d-3f9a1c2e", "code": "COS512", "title": "Final exam", "kind": "exam", "date": "2026-12-05", "time": "13:00", "topics": "Weeks 1 to 10" },
  { "id": "d-7b20e4aa", "code": "COS511", "title": "Term project talk", "kind": "other", "date": "2026-11-20" }
 ]
}
```

| Field | Rule |
|---|---|
| `id` | unique; for a new date use `d-` and 8 random hex characters; never change an existing one |
| `code` | a course code from `<sem>/semester.json` |
| `title` | short: "Final exam", "Repeat exam", "Project presentation" |
| `kind` | `"exam"` for exams (they also show as the course's exam on Today and Courses), else `"other"` |
| `date` | `YYYY-MM-DD` |
| `time` | optional, `HH:MM` 24-hour, as the course announced it (Cyprus time unless STUDENT.md says otherwise); leave it out when unknown |
| `topics` | optional: what it covers, where, what to bring |

If `dates.json` doesn't exist yet but `<sem>/_meta/exams.json` has exams, start `dates.json` from them (one `"kind": "exam"` date each: `kind` → `title`, `at` → `date` and `time`, no `time` when `notime` is true); after that only `dates.json` counts.

## Steps

1. Read `<sem>/semester.json` (course codes) and `<sem>/_meta/dates.json`.
2. Work out exactly what to add, change or remove. If the course, the day or what it is is unclear, ask in one short question before writing.
3. Edit the file: keep the other dates as they are, valid JSON, one-space indent. To change a date, edit that entry in place (same `id`); to remove one, delete its entry.
4. Reply in a line or two with what changed (title, course, date and time). The app picks the change up by itself.
