# Instructions for Claude Code

The workspace instructions are shared with other AI tools (Codex, local models) in AGENTS.md:

@AGENTS.md

About the student (personal, git-ignored; created by `ouc setup`):

@STUDENT.md

Claude-specific: the study agents are subagents in `.claude/agents/`, and the skills are in `.claude/skills/` (both generated from `ai/` by `ouc ai install`). The `ouc-dev-*` skills there are for changing the code only (generated from `dev/skills/` by `npm run dev:agents`); `.claude/settings.json` is the contributors' shared Claude Code config.
