import { test } from "node:test";
import assert from "node:assert/strict";
import { isV2, toClassic, toV2, v2Section } from "../src/v2/paths.ts";

test("classic paths map to the same page in v2", () => {
  assert.equal(toV2("/2026-Fall"), "/v2/2026-Fall");
  assert.equal(toV2("/2026-Fall/homework/COS511/a"), "/v2/2026-Fall/homework/COS511/a");
  assert.equal(toV2("/2026-Fall/courses/COS511#w3"), "/v2/2026-Fall/courses/COS511#w3");
  assert.equal(toV2("/2026-Fall/notes/COS511/week-01"), "/v2/2026-Fall/notes/COS511/week-01");
  assert.equal(toV2("/2026-Fall/assignments/COS511/10-26_Assignment-3"), "/v2/2026-Fall/assignments/COS511/10-26_Assignment-3");
});

test("classic pages that v2 folds into another open that one", () => {
  assert.equal(toV2("/2026-Fall/timeline"), "/v2/2026-Fall/calendar");
  assert.equal(toV2("/2026-Fall/assignments"), "/v2/2026-Fall/calendar");
  assert.equal(toV2("/2026-Fall/updates"), "/v2/2026-Fall/notifications");
  assert.equal(toV2("/2026-Fall/notes"), "/v2/2026-Fall/courses");
  assert.equal(toV2("/2026-Fall/quizzes"), "/v2/2026-Fall/courses");
});

test("v2 paths, files, the API and outside links are left alone", () => {
  for (const p of ["/v2/2026-Fall/notifications", "/files/2026-Fall/a.pdf", "/api/ai/view?path=x", "https://eclass.ouc.ac.cy", "//x.org/a", "#w2"]) assert.equal(toV2(p), p);
});

test("back to the classic look keeps the page", () => {
  assert.equal(toClassic("/v2/2026-Fall"), "/2026-Fall");
  assert.equal(toClassic("/v2/2026-Fall/calendar"), "/2026-Fall/timeline");
  assert.equal(toClassic("/v2/2026-Fall/notifications"), "/2026-Fall/updates");
  assert.equal(toClassic("/v2/2026-Fall/inbox"), "/2026-Fall/updates");
  assert.equal(toClassic("/v2/2026-Fall/settings"), "/2026-Fall");
  assert.equal(toClassic("/v2/2026-Fall/courses/COS511#notes"), "/2026-Fall/courses/COS511#notes");
  assert.equal(toClassic("/v2"), "/");
  assert.equal(toClassic("/2026-Fall/plan"), "/2026-Fall/plan");
});

test("the nav highlights the place a page belongs to", () => {
  assert.ok(isV2("/v2") && isV2("/v2/x") && !isV2("/v2x") && !isV2("/2026-Fall"));
  assert.equal(v2Section("/v2/2026-Fall"), "");
  assert.equal(v2Section("/v2/2026-Fall/plan/2026-W43"), "");
  assert.equal(v2Section("/v2/2026-Fall/notes/COS511/a"), "courses");
  assert.equal(v2Section("/v2/2026-Fall/homework/COS511/a"), "courses");
  assert.equal(v2Section("/v2/2026-Fall/class/COS511/3/2"), "courses");
  assert.equal(v2Section("/v2/2026-Fall/assignments/COS511/a"), "calendar");
  // an assignment opened from a course week keeps Courses highlighted
  assert.equal(v2Section("/v2/2026-Fall/assignments/COS511/a", "/v2/2026-Fall/courses/COS511"), "courses");
  assert.equal(v2Section("/v2/2026-Fall/assignments/COS511/a", "/v2/2026-Fall/calendar"), "calendar");
  // the header's pages light up no place in the nav
  assert.equal(v2Section("/v2/2026-Fall/notifications#x"), "notifications");
  assert.equal(v2Section("/v2/2026-Fall/settings"), "settings");
});
