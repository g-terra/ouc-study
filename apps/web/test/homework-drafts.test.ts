// Homework drafts: what was typed is kept in the browser until the app server has it, so a crash loses nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clearDraft, draftKey, keepDraft, restoreDraft } from "../src/lib/homework-drafts.ts";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), size: () => m.size };
};
const KEY = draftKey("2026-Fall", "COS514/10-29_Assignment-3", "2", "text");

test("a draft typed but not saved comes back after a reload", () => {
  const s = memory();
  keepDraft(s, KEY, "<p>Half an answer</p>");
  assert.equal(restoreDraft(s, KEY, "<p>Older saved answer</p>"), "<p>Half an answer</p>");
});

test("a draft the server already has is not restored, and is dropped", () => {
  const s = memory();
  keepDraft(s, KEY, "<p>Saved</p>");
  assert.equal(restoreDraft(s, KEY, "<p>Saved</p>"), null);
  assert.equal(s.size(), 0);
  assert.equal(restoreDraft(s, KEY, "<p>Saved</p>"), null);
});

test("a save clears its draft, but not a newer one typed while it was on its way", () => {
  const s = memory();
  keepDraft(s, KEY, "<p>One</p>");
  keepDraft(s, KEY, "<p>One two</p>");
  clearDraft(s, KEY, "<p>One</p>");
  assert.equal(restoreDraft(s, KEY, "<p>One</p>"), "<p>One two</p>");
  clearDraft(s, KEY, "<p>One two</p>");
  assert.equal(s.size(), 0);
});

test("each task and field has its own draft", () => {
  assert.notEqual(draftKey("S", "A/b", "1", "text"), draftKey("S", "A/b", "1", "why"));
  assert.notEqual(draftKey("S", "A/b", "1", "text"), draftKey("S", "A/b", "2", "text"));
});

test("no browser storage (private window, blocked): nothing breaks", () => {
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
  keepDraft(broken, KEY, "<p>x</p>");
  clearDraft(broken, KEY, "<p>x</p>");
  assert.equal(restoreDraft(broken, KEY, ""), null);
  assert.equal(restoreDraft(undefined, KEY, ""), null);
});
