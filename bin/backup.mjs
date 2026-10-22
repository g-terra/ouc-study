#!/usr/bin/env node
// `ouc backup`: launcher for packages/cli/src/backup.ts (see lib/run-ts.mjs).
//   node bin/backup.mjs [now|setup|restore|status]
import { runTs } from "./lib/run-ts.mjs";
const { main } = await runTs("packages/cli/src/backup.ts");
await main(process.argv.slice(2));
