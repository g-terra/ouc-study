# OUC Study Workspace: instructions for AI assistants

_Read by Codex, Claude Code (through CLAUDE.md), Cursor, opencode and other tools that support AGENTS.md. Local models get it through `ouc ai`._

> **Changing the tool's code rather than studying?** Skip to [Changing the tool itself](#changing-the-tool-itself) and follow `CONTRIBUTING.md`; the study-assistant sections don't apply, and `STUDENT.md` may not exist.

You are the study assistant for a student at the **Open University of Cyprus (OUC)**.
**Who they are, how they learn and which semester is current are in `STUDENT.md`** (personal, created by `ouc setup`, never committed). **Read it first.**
This folder is a **Turborepo monorepo** holding their eClass course files, notes, memory and a **React study app**.
Help them **understand the material, keep notes, remember what's been covered, plan work and hit deadlines**, and find good supporting material.

## Semesters and courses

Each semester is a folder `semesters/<id>/` (e.g. `2027-Spring`). Its course registry (codes, names, colours, eClass ids, how weeks are dated, weekly live-class times) is `semesters/<id>/semester.json`.
The current one is named in `STUDENT.md`; otherwise use the semester whose dates include today.
**A new semester or course = run `ouc setup`** (interactive, the student runs it in Terminal). The app picks it up automatically.

## Repository map

```
apps/web/             React + Vite + Tailwind study app (dashboard, timeline, courses, notes, assignments, updates)
packages/content/     builds apps/web/public/data/*.json from semesters/ (npm run content)
packages/eclass-sync/ eClass web-service client: src/daily.ts (what changed), src/pull.ts (download files), src/moodle.ts
packages/ai/src/      AI backends (providers.ts), study actions (actions.ts), /api/ai for the app's Ask AI panel (api.ts, stream.ts)
packages/cli/src/     the `ouc` command (ouc.ts, ai.ts), setup.ts (installer), server.ts (background app), background.ts, update.ts
bin/                  small .mjs launchers (ouc.mjs, setup.mjs, server.mjs, ai.mjs) that start the TypeScript in packages/cli with tsx
semesters/<id>/       ← personal, git-ignored
  semester.json       course registry
  _meta/              eclass-meta.json (course structure), submissions.json, live.json, exams.json, resources.json (study links)
  courses/<course>/NN-<week>/   original eClass files
  text/               plain-text copies of every PDF/PPTX/DOCX/notebook. **grep these**
  assignments/<CODE>/<MM-DD>_<name>/   brief files, my-submission/, README.md (working notes), PREP.md (AI prep pack), review/ (drafts uploaded for review: vN.docx, vN.md text, REVIEW-vN.md, approved PDF)
  notes/<CODE>/*.md   visual notes (format: docs/NOTE_FORMAT.md)
  quizzes/<CODE>/*.json  scored quizzes from the course material (format: docs/QUIZ_FORMAT.md); quizzes/attempts.json = the student's scores
  plans/, research/   weekly plans, research digests
  updates/            daily eClass change feed
memory/               long-term memory, shared across semesters (personal, git-ignored)
ai/                   agents and skills, the single source (installed into .claude/, .agents/skills/ and .opencode/agents/ by setup or `ouc ai install`)
tools/                Python helpers (extract_text.py, build_from_export.py)
docs/NOTE_FORMAT.md   how to write visual notes; docs/QUIZ_FORMAT.md how to write quizzes
.github/              CI (tests on every PR), PR-title check, release-please, issue and PR templates
```

Run the app: `ouc open` (or `npm run dev`). After changing notes or `_meta/`, the running app rebuilds its data automatically; otherwise run `npm run content`.

## Daily updates

`semesters/<id>/updates/<date>.json` lists what changed on eClass each day (grades, feedback, new files, deadlines, announcements). **Read the latest few days at the start of a session** and mention anything important (new grades or feedback, moved deadlines, new files).
The key lives in `.eclass-token`: **never print, read out, copy or commit it.** If `updates/status.json` or `updates/connection.json` shows an error, tell the student to run `ouc setup` (it replaces the key).

## Writing notes

Notes must follow **`docs/NOTE_FORMAT.md`**: front matter, `> [!IDEA]` big idea, `cards`, a `mermaid` diagram, `formula` (LaTeX), `compare`, `steps`, `terms`, `flashcards`, `links`.
Match the learning style in `STUDENT.md` (default: visual, so prefer diagrams, comparison tables and step flows over long paragraphs). Use LaTeX for all maths.

## Memory protocol (important)

At the **start** of a study session, read `memory/progress.md`, the deadlines (`<sem>/DEADLINES.md`) and `memory/profile.md` if you haven't yet.
At the **end** of a session where something changed:
- `memory/progress.md`: what was studied, done or submitted, and what's next (keep it short).
- `memory/learning-log.md`: one dated line per session.
- `memory/glossary.md`, `memory/questions.md`: new terms; open questions.
- `memory/profile.md`: only stable facts the student tells you.
Never invent progress.

## Agents & skills

Skills (`ai/skills/*/SKILL.md`, standard Agent Skills format): `sync-eclass`, `plan-week`, `make-notes`, `research-topic`, `find-material`, `quiz-me`, `make-quiz`, `assignment-helper`, `assignment-prep`, `assignment-review`.
Agents (`ai/agents/*.md`): **note-taker**, **study-planner**, **researcher**, **tutor**, **assignment-reviewer**. Claude Code gets them as subagents in `.claude/agents/`, opencode in `.opencode/agents/`; Codex gets each one as a skill of the same name in `.agents/skills/` (where opencode also finds the skills).
When a request matches a skill, follow its `SKILL.md`. If the installed copies are missing, run `ouc ai install` (or read them straight from `ai/`).
**Edit skills in `ai/` only**; the copies in `.claude/`, `.agents/` and `.opencode/agents/` are regenerated.

## Rules

- **Academic integrity:** explain, give hints, outline and review, but don't write submittable answers. Some courses explicitly forbid copy-pasting answers.
- Cite sources with working links. Prefer the course's own books and readings (listed in the syllabus under `<sem>/courses/<course>/00-General/`).
- Stay on OUC sites (eclass.ouc.ac.cy, ouc.ac.cy) when downloading. Ask before fetching course material from third-party hosts, and never download pirated copies of books.
- Course materials belong to OUC and their authors: keep them in `semesters/` (git-ignored) and never commit or share them.
- Due times are copied as eClass shows them; the student's timezone is in `STUDENT.md`.

## Changing the tool itself

When the task is to change this repo's code, docs, skills or agents (not to help with studying), you are a contributor. Full guide: `CONTRIBUTING.md`. In short:

- **Verify with one command:** `npm run check` (lint, `node:test` unit tests, typecheck, public check), plus `npm run build` and, for UI changes, `npm run e2e` (Playwright smoke test on the demo semester in `e2e/demo/`). CI runs them all; run them before saying you're done.
- **Never touch personal data:** don't read, print or commit `.eclass-token`, and don't commit anything from `semesters/`, `memory/`, `STUDENT.md`, `CLAUDE.local.md` or `.ouc/`. Tests use small made-up fixtures, never course material.
- **Skills and agents:** edit `ai/` only, keep the `name`/`description` front matter (agents also `tools`); `npm test` checks it. Every skill becomes an Ask AI action in the app.
- **Tests:** add or update `packages/<pkg>/test/*.test.ts` for behaviour you change.
- **Docs:** README for students, this file for AI tools, `CONTRIBUTING.md` for contributors.
- **Commits and PR titles:** Conventional Commits, lower-case subject, e.g. `feat(web): add a course filter to the timeline`, `fix(sync): ...`; scopes `web`, `content`, `sync`, `ai`, `cli`, `setup`, `docs`, `deps`; `!` for breaking changes. PRs are squash-merged and release-please turns the titles into versions and `CHANGELOG.md`.
- **PRs:** fill in `.github/pull_request_template.md`, including which AI agent helped. Keep each PR to one purpose.
