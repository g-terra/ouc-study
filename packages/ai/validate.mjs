#!/usr/bin/env node
// Checks a note or a prep pack: launcher for src/validate.ts (see bin/lib/run-ts.mjs).
//   node packages/ai/validate.mjs <note.md | PREP.md> [...] | --all  [--fix]
import { runTs } from "../../bin/lib/run-ts.mjs";
const { main } = await runTs("packages/ai/src/validate.ts");
main(process.argv.slice(2));
