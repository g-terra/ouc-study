// Important dates the student adds to a course (exams and anything else): semesters/<id>/_meta/dates.json.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importantDates, readDates, removeDate, saveDate } from "../src/dates.ts";

const CODES = ["DEM101", "DEM102"];
function sem(files: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ouc-dates-"));
  mkdirSync(join(dir, "_meta"));
  for (const [f, v] of Object.entries(files)) writeFileSync(join(dir, "_meta", f), JSON.stringify(v));
  return dir;
}

test("a new semester has no important dates", () => {
  assert.deepEqual(readDates(sem()), []);
});

test("adding a date saves it in _meta/dates.json with an id", () => {
  const dir = sem();
  const all = saveDate(dir, { code: "DEM101", title: "Final exam", kind: "exam", date: "2026-12-05", time: "13:00", topics: "Weeks 1 to 10" }, CODES);
  assert.equal(all.length, 1);
  assert.match(all[0]!.id, /^[\w-]+$/);
  assert.deepEqual({ ...all[0], id: "x" }, { id: "x", code: "DEM101", title: "Final exam", kind: "exam", date: "2026-12-05", time: "13:00", topics: "Weeks 1 to 10" });
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "_meta/dates.json"), "utf8")).dates, all);
});

test("a date without a time or topics keeps just the day, and two dates get different ids", () => {
  const dir = sem();
  saveDate(dir, { code: "DEM101", title: "Project talk", kind: "other", date: "2026-11-20" }, CODES);
  const all = saveDate(dir, { code: "DEM102", title: "Lab test", kind: "other", date: "2026-11-21", time: "", topics: " " }, CODES);
  assert.equal(all.length, 2);
  assert.notEqual(all[0]!.id, all[1]!.id);
  assert.deepEqual({ ...all[0], id: "x" }, { id: "x", code: "DEM101", title: "Project talk", kind: "other", date: "2026-11-20" });
});

test("saving with an id changes that date only", () => {
  const dir = sem();
  const [a] = saveDate(dir, { code: "DEM101", title: "Final exam", kind: "exam", date: "2026-12-05" }, CODES);
  saveDate(dir, { code: "DEM102", title: "Lab test", kind: "other", date: "2026-11-21" }, CODES);
  const all = saveDate(dir, { id: a!.id, code: "DEM101", title: "Final exam (moved)", kind: "exam", date: "2026-12-07", time: "09:30" }, CODES);
  assert.deepEqual(all.map((d) => [d.title, d.date, d.time]), [["Final exam (moved)", "2026-12-07", "09:30"], ["Lab test", "2026-11-21", undefined]]);
  assert.throws(() => saveDate(dir, { id: "nope", code: "DEM101", title: "X", kind: "exam", date: "2026-12-07" }, CODES), /doesn't exist/);
});

test("removing a date takes it out; an unknown id says so", () => {
  const dir = sem();
  const [a] = saveDate(dir, { code: "DEM101", title: "Final exam", kind: "exam", date: "2026-12-05" }, CODES);
  saveDate(dir, { code: "DEM102", title: "Lab test", kind: "other", date: "2026-11-21" }, CODES);
  assert.deepEqual(removeDate(dir, a!.id).map((d) => d.title), ["Lab test"]);
  assert.throws(() => removeDate(dir, a!.id), (e: Error & { code?: number }) => e.code === 404);
});

test("bad dates are refused with a plain reason", () => {
  const dir = sem();
  const ok = { code: "DEM101", title: "Final exam", kind: "exam", date: "2026-12-05" };
  assert.throws(() => saveDate(dir, { ...ok, code: "XYZ999" }, CODES), /course/i);
  assert.throws(() => saveDate(dir, { ...ok, title: "  " }, CODES), /title/i);
  assert.throws(() => saveDate(dir, { ...ok, date: "5/12/2026" }, CODES), /date/i);
  assert.throws(() => saveDate(dir, { ...ok, date: "2026-02-30" }, CODES), /date/i);
  assert.throws(() => saveDate(dir, { ...ok, time: "25:00" }, CODES), /time/i);
  assert.throws(() => saveDate(dir, { ...ok, kind: "party" }, CODES), /kind/i);
  assert.equal(existsSync(join(dir, "_meta/dates.json")), false);
});

test("exams written by hand in the old _meta/exams.json show as dates, and move into dates.json on the first change", () => {
  const dir = sem({ "exams.json": [{ code: "DEM101", kind: "Final exam", at: "2026-12-05T13:00" }, { code: "DEM101", kind: "Repeat exam", at: "2027-01-11T00:00", notime: true }] });
  const old = readDates(dir);
  assert.deepEqual(old.map(({ id, ...d }) => d), [
    { code: "DEM101", title: "Final exam", kind: "exam", date: "2026-12-05", time: "13:00" },
    { code: "DEM101", title: "Repeat exam", kind: "exam", date: "2027-01-11" },
  ]);
  const all = removeDate(dir, old[1]!.id);
  assert.deepEqual(all.map((d) => d.title), ["Final exam"]);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "_meta/dates.json"), "utf8")).dates.map((d: { title: string }) => d.title), ["Final exam"]);
  assert.deepEqual(readDates(dir).map((d) => d.title), ["Final exam"]);   // dates.json wins from now on
});

test("the app gets the dates oldest first, with a local time and whether one was given", () => {
  const out = importantDates([
    { id: "b", code: "DEM101", title: "Final exam", kind: "exam", date: "2026-12-05", time: "13:00", topics: "Weeks 1 to 10" },
    { id: "a", code: "DEM102", title: "Project talk", kind: "other", date: "2026-11-20" },
  ]);
  assert.deepEqual(out, [
    { id: "a", code: "DEM102", title: "Project talk", kind: "other", at: "2026-11-20T00:00:00", noTime: true },
    { id: "b", code: "DEM101", title: "Final exam", kind: "exam", at: "2026-12-05T13:00:00", noTime: false, topics: "Weeks 1 to 10" },
  ]);
});

test("a date written by hand without an id still shows, and can be changed", () => {
  const dir = sem({ "dates.json": { dates: [{ code: "DEM101", title: "Lab test", kind: "other", date: "2026-11-21" }, { code: "DEM101", title: "No day" }] } });
  const [d, ...rest] = readDates(dir);
  assert.equal(rest.length, 0);
  assert.equal(d!.title, "Lab test");
  assert.deepEqual(saveDate(dir, { ...d, title: "Lab exam" }, CODES).map((x) => [x.id, x.title]), [[d!.id, "Lab exam"]]);
});
