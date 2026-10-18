#!/usr/bin/env node
// `ouc setup` (or "Install OUC Study.command", npm run setup): launcher for packages/cli/src/setup.ts.
// Runs straight after `git clone`: lib/run-ts.mjs installs the dependencies first.
import { runTs } from "./lib/run-ts.mjs";
await runTs("packages/cli/src/setup.ts");
