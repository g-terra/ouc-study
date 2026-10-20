import { test } from "node:test";
import assert from "node:assert/strict";
import { TOUR, TOUR_KEY, clampStep, markTourSeen, placeCard, tourSeen } from "../src/v2/tour-steps.ts";

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

test("the tour is remembered once seen, and stays shut when there is no storage to remember it in", () => {
  const store = memory();
  assert.equal(tourSeen(store), false);
  markTourSeen(store);
  assert.equal(store.getItem(TOUR_KEY), "1");
  assert.equal(tourSeen(store), true);
  assert.equal(tourSeen({ getItem: () => { throw new Error("blocked"); } }), true);
});

test("the tour covers the main places, opening their pages", () => {
  const ids = TOUR.map((s) => s.id);
  for (const id of ["today", "courses", "course", "calendar", "bell", "ask-ai", "profile"]) assert.ok(ids.includes(id), id);
  assert.equal(new Set(ids).size, ids.length);
  const page = (id: string, c?: string) => TOUR.find((s) => s.id === id)!.page!(c);
  assert.equal(page("today"), "");
  assert.equal(page("calendar"), "/calendar");
  assert.equal(page("course", "COS 511"), "/courses/COS%20511");
  assert.equal(page("course"), "/courses");             // a semester without courses
  assert.equal(clampStep(-1), 0);
  assert.equal(clampStep(99), TOUR.length - 1);
});

test("the card sits below what it points at, above it near the bottom, and stays on screen", () => {
  const view = { width: 1000, height: 800 }, card = { width: 300, height: 200 };
  assert.deepEqual(placeCard({ top: 10, left: 400, width: 100, height: 40 }, card, view), { top: 62, left: 300 });
  assert.deepEqual(placeCard({ top: 700, left: 900, width: 80, height: 50 }, card, view), { top: 488, left: 688 });
  assert.deepEqual(placeCard({ top: 10, left: 0, width: 40, height: 40 }, card, view).left, 12);
  assert.deepEqual(placeCard(null, card, view), { top: 300, left: 350 });
});
