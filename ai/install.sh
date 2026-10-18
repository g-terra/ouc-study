#!/bin/sh
# Installs the study skills & agents for Claude Code (.claude/) and Codex (.agents/skills/).
cd "$(dirname "$0")/.." || exit 1
exec node ai/install.mjs
