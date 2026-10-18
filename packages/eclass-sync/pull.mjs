#!/usr/bin/env node
// `ouc pull`: launcher for src/pull.ts (see bin/lib/run-ts.mjs).
//   node packages/eclass-sync/pull.mjs [--dry-run] [--semester 2026-Fall] [--quiet]
import { runTs } from "../../bin/lib/run-ts.mjs";
const { main } = await runTs("packages/eclass-sync/src/pull.ts");
await main(process.argv.slice(2));
