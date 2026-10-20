import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNote } from "../src/notes/parse.ts";

test("a callout keeps a next line that has no \">\" (lazy continuation), up to a blank line", () => {
  const blocks = parseNote("> [!IDEA] Big idea\nThe made-up idea in one line,\n> and a quoted line.\n\nA normal paragraph.");
  assert.deepEqual(blocks[0], { type: "callout", kind: "IDEA", title: "Big idea", text: "The made-up idea in one line,\nand a quoted line." });
  assert.deepEqual(blocks[1], { type: "md", text: "A normal paragraph." });
});

test("a heading, a list, a fence or another callout ends a callout", () => {
  for (const next of ["## Section", "- a list item", "1. a step", "```mermaid", "> [!KEY] Next"]) {
    const blocks = parseNote(`> [!TIP] Tip\n> inside\n${next}`);
    assert.equal(blocks[0].type, "callout");
    assert.equal((blocks[0] as { text: string }).text, "inside", next);
    assert.equal(blocks.length > 1, true, next);
  }
});
