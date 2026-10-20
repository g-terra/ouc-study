<!--
Title: use Conventional Commits, e.g. `feat(web): add a course filter to the timeline` or `fix(sync): keep updated files`.
The title becomes the commit on main (squash merge) and drives the version and the changelog.
-->

## What changes

**Before:**

**After:**

Closes #

## How

<!-- A short paragraph: the approach and anything a reviewer should look at closely. -->

## Checklist

- [ ] `npm run check` passes (lint, tests, typecheck, public check) and `npm run build` works
- [ ] Tests added or updated for changed behaviour
- [ ] Docs updated where people will look (README, AGENTS.md, CONTRIBUTING.md, docs/)
- [ ] Study skills and agents edited in `ai/`, contributor tooling in `dev/` (not the generated `.claude/`, `.agents/`, `.opencode/` copies)
- [ ] Nothing personal: no eClass key, course materials, submissions, grades, notes, `STUDENT.md` or `memory/`

## AI assistance

- [ ] An AI coding agent helped with this PR (which one: ___ ), and I have read and tested every change
