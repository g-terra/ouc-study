# Contributing to OUC Study

Thanks for helping! OUC Study is built by students for students, and you are welcome to fix bugs, add features, improve the study agents or the docs, with or without an AI coding agent.

- [Ground rules](#ground-rules)
- [Raise an issue](#raise-an-issue)
- [Set up the code](#set-up-the-code)
- [Make a change](#make-a-change)
- [Commit messages and PR titles](#commit-messages-and-pr-titles)
- [Open a pull request](#open-a-pull-request)
- [Working with an AI coding agent](#working-with-an-ai-coding-agent)
- [Releases](#releases)

## Ground rules

1. **Nothing personal, ever.** No eClass key (`.eclass-token`), course materials, submissions, grades, notes, `STUDENT.md` or `memory/`. They are git-ignored; keep them that way. `npm run check:public` (also run by CI) flags them.
2. **Course materials belong to OUC and their authors.** Never commit or share them, not even as test fixtures. Make up small fake data instead (see `packages/ai/test/fixtures/`).
3. **Academic integrity.** The study agents explain, hint, plan and review; they must never write submittable answers. Changes to `ai/` keep that rule.
4. **Be kind.** We follow the [Code of Conduct](CODE_OF_CONDUCT.md).
5. **Security problems** go through [SECURITY.md](SECURITY.md), not public issues.

## Raise an issue

Use the [issue forms](../../issues/new/choose): **Bug report** or **Feature or improvement**. Search first to avoid duplicates.
Good issues are concrete enough that a person or an AI agent can pick them up: what happens, what should happen, and **acceptance criteria** (how we'll know it's done).

## Set up the code

You need Node.js 20 or newer (the LTS) and git.

```bash
git clone https://github.com/g-terra/ouc-study.git
cd ouc-study
npm ci
npm run check      # lint, tests, typecheck and the public check
npm run build      # builds the app; works without any eClass data
npm run e2e        # Playwright smoke test: every page on a demo semester (npx playwright install chromium first)
npm run dev        # runs the app at http://localhost:5173 (empty without a semester)
```

You don't need an OUC account to work on most of the code. To try it with real data, run `npm run setup` with your own eClass key; everything it downloads stays git-ignored on your computer.

### Where things live

| Folder | What | Checked by |
|---|---|---|
| `apps/web/` | React + Vite + Tailwind study app | `npm run typecheck`, `npm run build` |
| `packages/content/` | turns `semesters/` into the app's JSON | `npm run typecheck` |
| `packages/eclass-sync/` | eClass (Moodle web service) client | `npm run typecheck`, `npm test` |
| `packages/ai/` | AI backends, study actions, `/api/ai` | `npm test` |
| `ai/` | **the single source** of the study skills and agents | `npm test` (front matter) |
| `dev/` | setup for contributors' AI coding agents (guide, skills, cloud hook) | `npm test` |
| `packages/cli/` | `ouc` command, installer, background server, updates | `npm run typecheck`, `npm test` |
| `bin/` | small launchers that start `packages/cli` (their paths are used by installed copies, so keep them) | `npm run lint` |
| `docs/` | note format and examples | |

`AGENTS.md` explains the workspace to AI tools; `README.md` explains it to students.

### TypeScript

The code is TypeScript. Node runs it through [tsx](https://tsx.is), so there is no build step for the command line or the app server: `bin/*.mjs` are small launchers that register tsx and import `packages/cli/src/*.ts` (on a fresh clone they run `npm install` first). Keep those launcher paths: installed copies, login items and older `ouc update` code start them by name.

- Each package has its own `tsconfig.json` (strict, `noEmit`). Import local files with their `.ts` extension.
- Use only syntax Node can strip (`erasableSyntaxOnly`): no `enum`, `namespace` or constructor parameter properties, and `import type` for types. That keeps the door open to running on Node's own type stripping later.
- The only JavaScript left is the launchers (`bin/*.mjs`, `packages/eclass-sync/*.mjs`, `packages/ai/validate.mjs`), `ai/install.mjs` and `dev/*.mjs` (dependency-free, so any AI tool can run it with plain `node`) and test fixtures that stand in for other programs. Write new code in TypeScript.
- The smoke tests (`e2e/`) are TypeScript too; Playwright reads `e2e/playwright.config.ts`.

## Make a change

1. Branch from `main`: `git switch -c feat/timeline-filter`.
2. Keep the change focused: one PR, one purpose. Match the style of the code around it.
3. Add or update tests for behaviour you change (`node:test`, in `packages/<pkg>/test/*.test.ts`).
4. It runs on **macOS and Windows** (and Linux). Start programs with Node, not a shell script: `packages/cli/src/ouc.ts` is the `ouc` command, `packages/cli/src/background.ts` the per-OS background service, and `spawnCli` in `packages/ai/src/providers.ts` starts the agent CLIs (npm installs them as `.cmd` files on Windows).
5. **Skills and agents:** edit `ai/skills/<name>/SKILL.md` or `ai/agents/<name>.md`, then `ouc ai install` to try them. The copies in `.claude/`, `.agents/` and `.opencode/` are generated. A new skill appears as an action in the Ask AI panel automatically. Its `description` is written for the AI; the line the student sees on the action comes from `SUMMARY` in `packages/ai/src/actions.ts` (add one for a new skill, with no file paths).
6. Update the docs people will read: README for students, AGENTS.md for AI tools, this file for contributors.
7. Run `npm run check` and `npm run build` before pushing.

## Commit messages and PR titles

We use [Conventional Commits](https://www.conventionalcommits.org/). PRs are **squash-merged**, so the **PR title** becomes the commit on `main`; CI checks it.

```
<type>(<optional scope>): <lower-case summary>

feat(web): add a per-course filter to the timeline
fix(sync): keep the old file when eClass updates it
docs: explain the prep packs
feat(ai)!: rename the assignment-helper skill      ← "!" = breaking change
```

| Type | Use for | Release |
|---|---|---|
| `feat` | something new for users | minor |
| `fix` | a bug fix | patch |
| `perf` | faster, same behaviour | patch |
| `docs` | documentation only | patch, listed in the changelog |
| `refactor`, `test`, `build`, `ci`, `chore` | no user-visible change | none |
| `revert` | undo an earlier commit | patch |

Scopes (optional): `web`, `content`, `sync`, `ai`, `cli`, `setup`, `docs`, `deps`.
Add `BREAKING CHANGE: ...` in the body, or `!` after the type, for anything that breaks an existing install (renamed commands, moved folders, changed file formats).

## Open a pull request

- Fill in the [PR template](.github/pull_request_template.md): Before / After, how, the checklist.
- CI runs on every PR: **lint, unit tests, typecheck and a build on Node 20 and 22**, the same on **Windows** plus a real `ouc install`/`uninstall`, the **Playwright smoke test** (every page on the made-up semester in `e2e/demo/`), the **public check**, and the **PR title** check. All must pass.
- Changed a page or added one? Extend `e2e/smoke.spec.ts`, and the demo data in `e2e/demo/` if the page needs it (made-up data only).
- Say if an AI agent helped, and confirm you read and tested its changes. You are responsible for every line you submit.
- A maintainer reviews and squash-merges.

## Working with an AI coding agent

This repo is meant to be extended with **any** agentic coding tool: Claude Code, Codex, opencode (including local models), Cursor, Copilot, Gemini CLI and others. Their setup lives in [`dev/`](dev/README.md), apart from the students' study AI in `ai/`.

- **Set up once:** `npm run dev:agents` installs the project's contributor skills (`dev/skills/ouc-dev-*`) for Claude Code, Codex and opencode, and the [Superpowers](https://github.com/obra/superpowers) plugin for Claude Code in this checkout. [`dev/README.md`](dev/README.md) has Superpowers for the other tools. Claude Code cloud sessions set themselves up through the SessionStart hook in `.claude/settings.json`.
- **`AGENTS.md` is the entry point.** Most tools read it automatically (Claude Code through `CLAUDE.md`). Its section *Changing the tool itself* sends agents to [`dev/CODING.md`](dev/CODING.md): workflow, conventions, and what to test where.
- **Verify:** `npm run check`, `npm run build` and `npm run e2e`. Ask your agent to run them and show you the output before it says it's done.
- **Hand it an issue.** The issue forms ask for acceptance criteria so an agent can work from them: "Implement issue #12."
- **Personal data is off limits to agents too.** `.claude/settings.json` and `opencode.json` block the eClass key, and `AGENTS.md` tells every agent never to read, print or commit it. Don't paste course material into a prompt for a public issue or PR.
- **Review the diff yourself** before opening the PR, and keep it small.

Prompt that works well with any agent:

> Read AGENTS.md (section "Changing the tool itself") and dev/CODING.md. Implement <the change / issue #N> test-first. Update the docs, run `npm run check`, `npm run build` and `npm run e2e`, and propose a Conventional Commits PR title.

## Backup sign-in client

**Sign in with GitHub** in Settings → Backup needs the app's own OAuth client, whose id lives in `packages/backup/src/clients.ts` (public by design, so it's committed). While it's empty, only the pasted-token route is offered. To register it: on GitHub, Settings → Developer settings → OAuth Apps → New OAuth App (any homepage and callback URL, e.g. the repo's), then tick **Enable Device Flow**. Copy the Client ID into `GITHUB_CLIENT_ID`. No secret is needed.

To try another client without editing the file, set `OUC_GITHUB_CLIENT_ID`.

## Releases

Releases are automated with [release-please](https://github.com/googleapis/release-please):

1. Every merge to `main` first runs the **smoke test** on that code; only if it passes does release-please update the open **release PR** with the next version (from the commit types above) and the `CHANGELOG.md` entries. Its checks run like any PR's because release-please pushes with the maintainer's `RELEASE_PLEASE_TOKEN` secret (a fine-grained token for this repo with Contents and Pull requests read/write); without it GitHub runs no checks on the release PR.
2. The release PR merges itself (squash) as soon as its required checks pass, which tags the version (`v0.2.0`), publishes a GitHub release and bumps `version` in `package.json`. While `.github/release-hold` is on `main`, it stays open instead (to try `main` out first): merge it by hand, or delete that file to go back to automatic releases.

While we are below 1.0, `feat` bumps the minor version and breaking changes bump the minor too. Installed copies see the new release within the hour (the app's **Update available** bar, or `ouc update --check`) and move to its tag with `ouc update`, so only released code reaches students; a release whose lockfile changed is reinstalled with `npm ci`.
