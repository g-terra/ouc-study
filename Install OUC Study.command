#!/bin/bash
# Double-click to set up OUC Study (first time, or to add courses / a new semester).
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "OUC Study needs Node.js (free). Opening https://nodejs.org: install the LTS version, then double-click this again."
  open "https://nodejs.org"; read -r -p "Press Enter to close…"; exit 1
fi
node bin/setup.mjs "$@"
echo; read -r -p "Press Enter to close this window…"
