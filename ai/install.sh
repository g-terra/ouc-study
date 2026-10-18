#!/bin/sh
# Installs the study skills & agents for Claude Code (.claude/), Codex (.agents/skills/) and opencode (.opencode/agents/).
cd "$(dirname "$0")/.." || exit 1
exec node ai/install.mjs
