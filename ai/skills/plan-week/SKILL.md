---
name: plan-week
description: Create or update this week's study and delivery plan across all the semester's courses from <sem>/DEADLINES.md, memory/progress.md and the course week maps. Use for "plan my week", "what's next", "what should I work on today", "am I on track".
---

_Paths: `<sem>` = the current semester folder (named in STUDENT.md; otherwise the newest folder under `semesters/`)._

# Plan the week

1. Run `date` to get today's date and the ISO week.
2. Read the deadlines (app dashboard, or `<sem>/_meta/eclass-meta.json`), `memory/progress.md`, `memory/profile.md`, each `<sem>/courses/*/README.md` (find the section whose date range contains today), the latest plan in `<sem>/plans/` (its `- [x]` ticks are what the student has done) and `<sem>/progress.json` if it exists (`done`: each video, slide deck, file or link they ticked off as watched or read, by course and week index). Plan what's still open in past and current weeks before new material.
3. Delegate to the **study-planner** agent if your tool has subagents, otherwise follow `ai/agents/study-planner.md` yourself, to write `<sem>/plans/<YYYY>-W<NN>.md` in the exact format that agent describes (the app shows it as the Plan page, with checkboxes).
4. Reply with the plan's path in `backticks` (the app links it to the Plan page), then the next 3 actions, deadlines in the next 14 days, this week's live classes (in `<sem>/DEADLINES.md`) with what to prepare for each, and one risk. Keep it under 15 lines. Don't estimate how long tasks take (no hours or minutes); dates and days left are fine.
5. If they answer with what they've done, update `memory/progress.md` and the DEADLINES status.
