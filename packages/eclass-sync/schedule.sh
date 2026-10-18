#!/bin/sh
# Superseded by bin/ouc (it installs both the background app and the daily sync).
exec bash "$(cd "$(dirname "$0")/../.." && pwd)/bin/ouc" "${1:-install}"
