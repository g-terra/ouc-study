# dev/: setup for AI coding agents

Everything here is for **changing OUC Study's code** with an AI coding agent (Claude Code, Codex, opencode, Cursor, Gemini CLI…). It is kept apart from the students' study AI in `ai/`, which the app and `ouc ai install` use.

| File | What |
|---|---|
| [`CODING.md`](CODING.md) | The coding guide: workflow, stack conventions (TypeScript, React, Vite, Tailwind, Turborepo), what to test where, rules. `AGENTS.md` points every agent here. |
| `skills/ouc-dev-*/` | The project's own contributor skills (standard Agent Skills format): `ouc-dev-testing`, `ouc-dev-web`, `ouc-dev-study-ai`, `ouc-dev-ship`. |
| `install.mjs` | `npm run dev:agents`: installs those skills for your agents and Superpowers for Claude Code. |
| `session-start.mjs` | The SessionStart hook in `.claude/settings.json`. In Claude Code cloud sessions it runs `npm ci`, points Playwright at the image's Chromium, and installs the skills and Superpowers. Elsewhere it does nothing. |

## Set up your checkout

```bash
npm ci
npm run dev:agents
```
That copies `dev/skills/` to `.claude/skills/` (Claude Code) and `.agents/skills/` (Codex, opencode), and turns on the [Superpowers](https://github.com/obra/superpowers) plugin for Claude Code **in this checkout only** (`.claude/settings.local.json`, not committed). Run it again after pulling changes to `dev/skills/`. The copies are git-ignored; edit the files in `dev/skills/`.

Superpowers for your other tools, installed once per tool:

| Tool | How |
|---|---|
| Claude Code | `npm run dev:agents`, or `/plugin install superpowers@claude-plugins-official` |
| Codex | `/plugins` → search "superpowers" → Install Plugin |
| opencode | add `"plugin": ["superpowers@git+https://github.com/obra/superpowers.git"]` to `~/.config/opencode/opencode.json` (not the repo's `opencode.json`, which the study runs use) |
| Cursor | `/add-plugin superpowers` |
| Gemini CLI | `gemini extensions install https://github.com/obra/superpowers` |

Cloud sessions (Claude Code on the web, Claude projects) need nothing: the SessionStart hook fetches Superpowers at a pinned version (`SUPERPOWERS.ref` in `install.mjs`) and adds its skills.

## How it stays out of the students' way

- **Different folders, different installers.** Study skills come from `ai/` via `ai/install.mjs`; contributor skills from `dev/skills/` via `dev/install.mjs`. Each installer removes and rewrites only its own copies, so running one never deletes the other's. Contributor skills are named `ouc-dev-*` and say "Contributor only" in their description, so a study session won't pick them.
- **No Ask AI actions.** Only `ai/skills/` becomes buttons in the app.
- **Superpowers is off for study runs.** Ask AI and `ouc ai` start Claude Code with `--settings packages/ai/claude-study-settings.json`, which turns the plugin off even in a checkout where you turned it on.
- **The shared `.claude/settings.json` turns on no plugin**: it only allows the repo's check commands, blocks the eClass key, and adds the cloud-only hook.

## Changing this setup

Edit `dev/`, keep the `name`/`description` front matter (`packages/cli/test/dev-agents.test.ts` checks it and the installers), and update `CODING.md` when a convention changes. Bump `SUPERPOWERS.ref` deliberately, after reading its release notes.
