#!/usr/bin/env node
// `ouc transcribe`: launcher for packages/ai/src/transcribe.ts (see lib/run-ts.mjs).
//   node bin/transcribe.mjs [--setup] [--semester 2026-Fall]
import { runTs } from "./lib/run-ts.mjs";
const { main } = await runTs("packages/ai/src/transcribe.ts");
await main(process.argv.slice(2));
