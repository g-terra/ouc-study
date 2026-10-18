#!/usr/bin/env node
// `ouc ai`, `ouc notes`, `ouc plan`, `ouc quiz`: launcher for packages/cli/src/ai.ts (see lib/run-ts.mjs).
import { runTs } from "./lib/run-ts.mjs";
const { main } = await runTs("packages/cli/src/ai.ts");
await main();
