import { test } from "node:test";
import assert from "node:assert/strict";
import { chatPathFor, isChatPath } from "../src/lib/chat-path.ts";

test("the full-page chat is recognised in both looks", () => {
  for (const p of ["/2026-Fall/chat", "/2026-Fall/chat/", "/2026-Fall/chat/abc-123", "/v2/2026-Fall/chat", "/v2/2026-Fall/chat/abc-123#end"]) assert.ok(isChatPath(p), p);
  for (const p of ["/", "/2026-Fall", "/v2/2026-Fall", "/2026-Fall/courses/chat", "/2026-Fall/chat/a/b", "/v2/2026-Fall/notes/DEMO/chat"]) assert.ok(!isChatPath(p), p);
});

test("a chat's address keeps the semester and the look", () => {
  assert.equal(chatPathFor("/2026-Fall/chat", "abc"), "/2026-Fall/chat/abc");
  assert.equal(chatPathFor("/v2/2026-Fall/chat/old", "new"), "/v2/2026-Fall/chat/new");
  assert.equal(chatPathFor("/v2/2026-Fall/chat/old"), "/v2/2026-Fall/chat");
  assert.equal(chatPathFor("/2026-Fall/chat/x", "a/b"), "/2026-Fall/chat/a%2Fb");
  assert.equal(chatPathFor("/2026-Fall/courses", "abc"), "/2026-Fall/courses");
});
