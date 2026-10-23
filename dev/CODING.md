# Coding guide for AI agents (and people)

How to change OUC Study's code well. Read it before you write code; `AGENTS.md` sends you here.
This is about the **code**. The student-facing study assistant (`ai/`, `STUDENT.md`, `memory/`, `semesters/`) is a different job with its own rules; don't load or follow them while coding.

## Workflow: discovery → plan → build → test → review

Every change goes through these five stages, using [Superpowers](https://github.com/obra/superpowers) skills (setup: [dev/README.md](README.md)). **TDD is not optional**: no production code without a failing test that asked for it.

| Stage | Superpowers skill | What it means here |
|---|---|---|
| 1. Discovery | brainstorming (bugs: systematic-debugging) | Understand the ask and the code it touches; agree the design and its acceptance criteria. A bug starts by reproducing it. |
| 2. Plan | writing-plans | Small tasks, each naming its test first: which layer (see [Testing](#testing-what-and-where)), which file, what it asserts. |
| 3. Build | test-driven-development, inside executing-plans or subagent-driven-development | For each task: **red** (write the test, run it, watch it fail for the right reason) → **green** (the least code that passes) → **refactor** (clean up with the tests green). Commit per task. |
| 4. Test | verification-before-completion | The whole suite, not just your tests: `npm run check`, `npm run build`, `npm run e2e`; look at UI changes at desktop and phone widths. Read the output; no "should pass". |
| 5. Review | requesting-code-review → finishing-a-development-branch, then `ouc-dev-ship` | Review the diff against the plan and this guide, fix what it finds (back to build, test first), retake README screenshots the change made out of date, then open the PR. |

Scale the stages, never skip them: a one-line, clearly specified fix can have a two-line plan, but it still gets a failing test first, the full check and a review of the diff. Bugs always get a regression test that fails before the fix.

House rules on top of Superpowers:
- **Running unattended?** In a cloud or background session nobody answers questions quickly: take the reasonable default, write it down in the PR's "How", and keep going.
- **Stay on your branch.** Don't create git worktrees unless asked; cloud sessions are given a branch to push.
- **Specs and plans stay local.** `docs/superpowers/` is git-ignored; put the design summary in the PR description instead.
- **Before you say "done"**: verification-before-completion, i.e. run the commands below and read their output.
- **README screenshots follow the UI.** When a change alters anything a README screenshot shows (a page, the header, a pop-up, the theme), retake the affected screenshots in the same PR. How: `ouc-dev-ship`, step 3.

The project's own skills, `dev/skills/ouc-dev-*` (installed as skills by `npm run dev:agents`), add the repo's specifics to those stages:
`ouc-dev-testing` (plan and build: what to test, where and how), `ouc-dev-web` (pages and components in the app), `ouc-dev-study-ai` (changing the students' skills, agents or Ask AI), `ouc-dev-ship` (review: checks, PR, release).

## Verify

```bash
npm run check   # lint (scripts parse) + node:test unit tests + typecheck (every workspace) + public check
npm run build   # turbo: content → vite build
npm run e2e     # Playwright on the made-up semester in e2e/demo/ (needs Chromium; see ouc-dev-testing)
```
CI runs all three on Node 20 and 22, and lint/test/typecheck/build on Windows. Run `npm test -- --test-name-pattern "<name>"` while iterating.

## Stack and conventions

**Monorepo (npm workspaces + Turborepo).** `apps/web` (React app), `packages/content` (semesters/ → app JSON, search), `packages/eclass-sync` (Moodle web-service client), `packages/ai` (agent CLIs, `/api/ai`, slides, transcripts), `packages/backup` (backups to a private GitHub repo), `packages/cli` (`ouc` command, installer, background server), `e2e` (Playwright). `turbo.json` makes `build`/`dev` depend on `content`. Add a dependency to the workspace that uses it (`npm i -w @ouc/web x`), never to the root unless every workspace needs it, and commit `package-lock.json`. Keep the root on one Vite major (`packages/cli/test/deps.test.ts` guards it). Fewer dependencies is better: this installs on students' laptops.

**TypeScript, no build step.** Node runs `.ts` through tsx. Strict mode, `noEmit`, imports with the `.ts` extension, and only erasable syntax: no `enum`, `namespace` or constructor parameter properties; `import type` for types. New code is TypeScript; the only `.mjs` left are launchers in `bin/`, `ai/install.mjs`, `dev/*.mjs` and test fixtures. Prefer small pure functions with explicit types at module boundaries; let inference do the rest. No `any` outside tests.

**React 19 + Vite + Tailwind 4.**
- Function components and hooks only. Derive values during render instead of copying props into state; `useEffect` only to sync with something outside React (DOM events, timers, fetch), always with a cleanup and complete dependencies.
- Put logic that isn't rendering in `apps/web/src/lib/*.ts` (or `packages/content/src` when the build also needs it) with no React imports, so `node:test` can test it.
- Routing is the small router in `src/lib/router.tsx` (`<Routes>`, `useRouter`, `Link`); routes are listed in `App.tsx`. Data comes from `useSemester()` (`src/lib/data.tsx`), which the dev server refreshes live.
- The **new look** (`src/v2/`) is the default; classic pages stay until the owner says to remove them. Links in shared pages use classic paths; `v2/paths.ts` maps them.
- Style with Tailwind classes and the theme tokens in `src/index.css` (every theme, light and dark); icons from `src/components/icons.tsx` (lucide line icons), never emoji in the new look.
- Accessible by default: real `<button>`/`<a>`, labels on icon buttons (`aria-label`), headings in order, focus visible. The e2e tests find things by role and name, so this is also what makes them testable.
- Must work on a phone width (390 px) as well as desktop.

**Node code (`packages/*`).** ESM, `node:` imports, async fs where a server waits on it. Cross-platform: build paths with `node:path`, start programs through `spawnCli`/`resolveCommand` (`packages/ai/src/providers.ts`), never through a shell string; no bash-only scripts. Never log or send the eClass key. Network calls get a timeout.

**Style.** Match the file you're in: comment density, naming, terse helpers. A comment says *why*, in one line. Small focused files; no dead code, no unused exports.

## Testing: what and where

Test-driven: write the test first and see it fail, then write the code. Every behaviour change ships with a test that failed without it. Details and examples: `dev/skills/ouc-dev-testing/SKILL.md`.

| You changed | Test it in | With |
|---|---|---|
| Pure logic in `apps/web/src/lib` or `v2/*.ts` | `apps/web/test/*.test.ts` | `node:test`, no DOM |
| Content build, search, quiz, plan, progress | `packages/content/test/` | made-up `Course`/`Week` objects, temp dirs |
| eClass sync | `packages/eclass-sync/test/` | a fake `MoodleClient` whose `call` returns made-up sections |
| AI backends, `/api/ai`, slides, transcripts | `packages/ai/test/` | `helpers.ts`, fake CLIs in `fixtures/` |
| Backups | `packages/backup/test/` | temp dirs, a local bare git repo as the remote; never the network |
| `ouc` command, installer, updates | `packages/cli/test/` | temp dirs, no real installs |
| A page, a component or a user flow | `e2e/*.spec.ts` | Playwright on `e2e/demo/`, `page.route` to mock `/api/ai/*` |

Never use real course material, names or eClass data in tests or fixtures; make up small data.

## Never

- Read, print or commit `.eclass-token`; commit anything from `semesters/`, `memory/`, `STUDENT.md`, `CLAUDE.local.md`, `.ouc/` (`npm run check:public` catches most).
- Write production code before a failing test asks for it, or skip, disable or loosen a test to get green.
- Put contributor tooling in `ai/` (every skill there becomes a button in the students' app) or study tooling in `dev/`.
- Edit the generated copies in `.claude/skills`, `.claude/agents`, `.agents/skills`, `.opencode/agents`; edit `ai/` or `dev/skills/`.
