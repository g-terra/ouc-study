---
name: ouc-dev-study-ai
description: Contributor only. Use when changing the students' study AI as code: the skills and agents in ai/, the Ask AI actions, prompts or backends in packages/ai. Not for studying, and not for the contributor tooling in dev/.
---

# Changing the students' AI tooling

Two separate worlds live in this repo. Keep them apart:

| | Students' study AI | Contributors' coding AI |
|---|---|---|
| Source | `ai/skills/`, `ai/agents/` | `dev/skills/`, `dev/CODING.md`, `.claude/settings.json` |
| Installed by | `ouc ai install` (`ai/install.mjs`) | `npm run dev:agents` (`dev/install.mjs`), the cloud SessionStart hook |
| Shows up in | the app's Ask AI actions, the study agents | coding sessions only |

## Skills and agents (ai/)

- Edit `ai/skills/<name>/SKILL.md` or `ai/agents/<name>.md` only. The copies in `.claude/`, `.agents/skills/`, `.opencode/agents/` are generated (they carry a "generated from ai/" line) and git-ignored.
- Keep the front matter: `name` (matches the folder or file), `description` (says when to use it); agents also `tools`. `packages/ai/test/ai-folder.test.ts` checks it.
- **Every skill in `ai/skills/` becomes an Ask AI action.** The student-facing line comes from `SUMMARY` in `packages/ai/src/actions.ts` (no file paths); fields for its form from the same file. Add both for a new skill.
- Academic integrity is a hard rule: the study AI explains, hints, plans and reviews; it never writes submittable answers.
- Install and try: `node ai/install.mjs`, then run the action from the app or `ouc ai`.

## Backends (packages/ai)

- `providers.ts`: how each tool runs (`agentCommand`: Claude Code, Codex, opencode), model lists, `spawnCli` for Windows-safe starts. Claude Code study runs pass `--settings packages/ai/claude-study-settings.json`, which turns off contributor plugins such as Superpowers; keep it when changing the arguments.
- `api.ts` + `stream.ts`: `/api/ai` for the app (runs, chat history, prep packs, reviews).
- Never let a run read `.eclass-token` (Claude `--disallowedTools`, `opencode.json` permissions, Codex sandbox).
- Tests: `packages/ai/test/` with `fixtures/fake-agent.mjs` in place of the real CLIs; e2e mocks `/api/ai/*` with `page.route`. No real agent runs in CI.
