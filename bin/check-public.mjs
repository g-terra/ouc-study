#!/usr/bin/env node
// `ouc check-public` (npm run check:public): launcher for packages/cli/src/check-public.ts.
import { runTs } from "./lib/run-ts.mjs";
await runTs("packages/cli/src/check-public.ts");
