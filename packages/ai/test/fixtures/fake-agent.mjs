#!/usr/bin/env node
// Stands in for `claude -p … --output-format stream-json` in tests: prints a short canned run.
const args = process.argv.slice(2);
const prompt = args[args.indexOf("-p") + 1] ?? "";
const resume = args.includes("--resume") ? args[args.indexOf("--resume") + 1] : null;
const out = (j) => console.log(JSON.stringify(j));
out({ type: "system", subtype: "init", session_id: resume ?? "sess-1" });
// a prep pack request: write the file it names, like a real agent would
const prep = prompt.match(/save the pack as (\S+PREP\.md)/)?.[1];
if (prep) (await import("node:fs")).writeFileSync(`${process.cwd()}/${prep}`, `# Prep\n\nHints for ${prep}\n`);
if (prompt.includes("FAIL")) { console.error("boom: something broke"); process.exit(3); }
out({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: `${process.cwd()}/memory/progress.md` } }] } });
out({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: `${process.cwd()}/semesters/2026-Fall/plans/2026-W42.md`, content: "x" } }] } });
out({ type: "assistant", message: { content: [{ type: "text", text: resume ? "Second turn." : "Plan saved." }] } });
out({ type: "result", subtype: "success", is_error: false, result: "Plan saved.", session_id: resume ?? "sess-1" });
