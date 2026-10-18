#!/usr/bin/env node
// The background app: launcher for packages/cli/src/server.ts (see lib/run-ts.mjs).
import { runTs } from "./lib/run-ts.mjs";
await runTs("packages/cli/src/server.ts", { install: false });
