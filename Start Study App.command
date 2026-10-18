#!/bin/bash
# Double-click to open the OUC Study app (starts the background service if it isn't running).
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Install Node.js from https://nodejs.org first."; open "https://nodejs.org"; read -r -p "Press Enter to close…"; exit 1; }
if ! ls semesters/*/semester.json >/dev/null 2>&1; then echo "Not set up yet: starting the installer."; node bin/setup.mjs; exit; fi
[ -d node_modules ] || npm install
bash bin/ouc open
