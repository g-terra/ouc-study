#!/usr/bin/env node
// `ouc`: launcher for packages/cli/src/ouc.ts (see lib/run-ts.mjs). Started through bin/ouc or bin/ouc.cmd.
import { runTs } from "./lib/run-ts.mjs";
await runTs("packages/cli/src/ouc.ts");
