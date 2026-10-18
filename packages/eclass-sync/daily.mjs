#!/usr/bin/env node
// `ouc sync` and the background job: launcher for src/daily.ts (see bin/lib/run-ts.mjs).
//   node packages/eclass-sync/daily.mjs [--check] [--quiet] [--json]
// Keep this path: the LaunchAgent / Windows scheduled task `ouc install` wrote start it by name.
// install: false because a background job can't run npm (same as bin/server.mjs).
import { runTs } from "../../bin/lib/run-ts.mjs";
const { main } = await runTs("packages/eclass-sync/src/daily.ts", { install: false });
await main(process.argv.slice(2));
