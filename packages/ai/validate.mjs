#!/usr/bin/env node
// Checks a note, a prep pack or a quiz: launcher for src/validate.ts (see bin/lib/run-ts.mjs).
//   node packages/ai/validate.mjs <note.md | PREP.md | quiz.json> [...] | --all  [--fix]
import { runTs } from "../../bin/lib/run-ts.mjs";
const { main } = await runTs("packages/ai/src/validate.ts");
main(process.argv.slice(2));
