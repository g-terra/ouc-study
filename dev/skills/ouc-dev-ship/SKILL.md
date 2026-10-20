---
name: ouc-dev-ship
description: Contributor only. Use when finishing a change to OUC Study's code: final checks, commit, Conventional Commits PR title, the PR template, CI and how releases go out. Not for studying.
---

# Shipping a change

## 1. Verify (read the output, don't assume)

```bash
npm run check    # lint + unit tests + typecheck + public check
npm run build
npm run e2e      # when anything in the app or the server changed
```
All green, or you are not done. A failure you didn't cause still gets reported, not ignored.

## 2. Review your own diff

`git diff main...` as a reviewer would: one purpose per PR, no stray files, no debug output, docs updated where people look (README for students, AGENTS.md for AI tools, CONTRIBUTING.md for contributors, `dev/` for coding agents), nothing personal (`npm run check:public`). With Superpowers, run requesting-code-review.

## 3. Commit and PR

- Conventional Commits with a lower-case subject: `feat(web): add a course filter to the timeline`, `fix(sync): keep the old file when eClass updates it`. Scopes: `web`, `content`, `sync`, `ai`, `cli`, `setup`, `docs`, `deps`; `!` or `BREAKING CHANGE:` for anything that breaks an install. Contributor tooling is `build:` or `docs:`.
- The PR title is the squash commit on `main` and drives the version: `feat` → minor, `fix`/`perf`/`docs` → patch, `refactor`/`test`/`build`/`ci`/`chore` → no release.
- Fill in `.github/pull_request_template.md`: Before / After, How (including any default you chose without asking), the checklist, which AI agent helped.
- Superpowers' specs and plans in `docs/superpowers/` stay local (git-ignored); summarise them in the PR.

## 4. CI and release

CI runs lint, tests, typecheck and build on Node 20 and 22 and Windows, the Playwright smoke test, the public check and the PR title check. Fix red CI by finding the cause; never skip or loosen a test, never push an empty commit to re-run.
After the squash merge, release-please opens or updates the release PR, which merges itself when its checks pass and publishes `vX.Y.Z`. Installs pick up tagged releases only.
