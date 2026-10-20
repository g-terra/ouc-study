---
name: ouc-dev-ship
description: Contributor only. Use when finishing a change to OUC Study's code: final checks, commit, Conventional Commits PR title, the PR template, CI and how releases go out. Not for studying.
---

# Shipping a change

Stages 4 (test) and 5 (review) of the flow in `dev/CODING.md`. You get here only after building test-first: every behaviour change has a test that you saw fail before the code was written.

## 1. Verify (read the output, don't assume)

```bash
npm run check    # lint + unit tests + typecheck + public check
npm run build
npm run e2e      # when anything in the app or the server changed
```
All green, or you are not done. A failure you didn't cause still gets reported, not ignored.

## 2. Review your own diff

`git diff main...` as a reviewer would: one purpose per PR, no stray files, no debug output, docs and README screenshots updated where people look (README for students, AGENTS.md for AI tools, CONTRIBUTING.md for contributors, `dev/` for coding agents), nothing personal (`npm run check:public`). Run Superpowers' requesting-code-review, and check that each change has its test (TDD) and the plan's acceptance criteria are met. Fix findings test-first, then verify again.

## 3. README screenshots

The README shows the app in screenshots (`docs/images/<name>.webp` and `<name>-dark.webp`, each pair in a `<picture>`). If your change alters anything one of them shows, such as a page, the header and its icons, a pop-up or the colours, retake that pair in this PR. Adding a feature the README describes? Add a screenshot for it the same way, or update its text.

- **Data:** a made-up semester only (start from `e2e/demo/`), never real courses, names or grades.
- **Capture:** Playwright on the app (`cd e2e && node --import tsx serve.ts` serves the demo on port 5180), viewport 1000×625 at `deviceScaleFactor: 2` (2000×1250 images), the tour dismissed (`localStorage` `ouc-tour-seen` = `1`), once with `colorScheme: "light"` and once with `"dark"`. Keep the same framing as the old image.
- **Format:** WebP under about 120 KB. Without extra tools, Chromium can encode it: draw the PNG on a canvas in the page and save `canvas.toDataURL("image/webp", 0.9)`.
- **Text:** keep the file names, and update the `alt` text and the caption if what they say changed.
- Look at every new image before committing it.

## 4. Commit and PR

- Conventional Commits with a lower-case subject: `feat(web): add a course filter to the timeline`, `fix(sync): keep the old file when eClass updates it`. Scopes: `web`, `content`, `sync`, `ai`, `cli`, `setup`, `docs`, `deps`; `!` or `BREAKING CHANGE:` for anything that breaks an install. Contributor tooling is `build:` or `docs:`.
- The PR title is the squash commit on `main` and drives the version: `feat` → minor, `fix`/`perf`/`docs` → patch, `refactor`/`test`/`build`/`ci`/`chore` → no release.
- Fill in `.github/pull_request_template.md`: Before / After, How (including any default you chose without asking), the checklist, which AI agent helped.
- Superpowers' specs and plans in `docs/superpowers/` stay local (git-ignored); summarise them in the PR.

## 5. CI and release

CI runs lint, tests, typecheck and build on Node 20 and 22 and Windows, the Playwright smoke test, the public check and the PR title check. Fix red CI by finding the cause; never skip or loosen a test, never push an empty commit to re-run.
After the squash merge, release-please opens or updates the release PR, which merges itself when its checks pass and publishes `vX.Y.Z`. Installs pick up tagged releases only.
