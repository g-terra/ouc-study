import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClasses, pickGroup, weekday, zoned } from "../src/classes.mjs";

// made-up course: three dated weeks (Mon–Sun) plus the undated General section
const weeks = [
  { index: 0, name: "General" },
  { index: 1, name: "Week 1: Basics", start: "2026-09-07", end: "2026-09-13" },
  { index: 2, name: "Week 2: More", start: "2026-09-14", end: "2026-09-20" },
  { index: 3, name: "Week 3: Last", start: "2026-09-21", end: "2026-09-27" },
];

test("weekday accepts names, short names and numbers", () => {
  assert.equal(weekday("Tuesday"), 2);
  assert.equal(weekday("thu"), 4);
  assert.equal(weekday(0), 0);
  assert.equal(weekday("someday"), -1);
});

test("zoned adds the time zone's offset, summer and winter", () => {
  assert.equal(zoned("2026-10-19T18:00", "Europe/Nicosia"), "2026-10-19T18:00:00+03:00");
  assert.equal(zoned("2026-11-02T18:00", "Europe/Nicosia"), "2026-11-02T18:00:00+02:00");
});

test("one class per dated week, on the right day, linked to the week", () => {
  const out = buildClasses({ code: "X1", cfg: { day: "Tue", time: "19:00" }, weeks, joinUrl: "https://example.test/join" });
  assert.deepEqual(out.map((c) => c.at), ["2026-09-08T19:00:00+03:00", "2026-09-15T19:00:00+03:00", "2026-09-22T19:00:00+03:00"]);
  assert.deepEqual(out.map((c) => [c.n, c.weekIndex]), [[1, 1], [2, 2], [3, 3]]);
  assert.equal(out[0].joinUrl, "https://example.test/join");
  assert.equal(out[0].end, "2026-09-08T17:00:00.000Z");
});

test("no classes without a valid slot", () => {
  assert.deepEqual(buildClasses({ code: "X1", weeks }), []);
  assert.deepEqual(buildClasses({ code: "X1", cfg: { day: "nope" }, weeks }), []);
});

test("the teaching group's time wins; the group is read from eClass group names", () => {
  const cfg = { day: "Tue", time: "19:00", groups: { "F.02": { time: "20:00" }, "F.03": {} } };
  assert.equal(pickGroup(cfg, ["2026_X1_F.02"]), "F.02");
  assert.equal(pickGroup({ ...cfg, group: "F.03" }, ["2026_X1_F.02"]), "F.03");
  assert.equal(pickGroup(cfg, ["Everyone"]), undefined);
  const out = buildClasses({ code: "X1", cfg, weeks, groups: ["2026_X1_F.02"] });
  assert.equal(out[0].at, "2026-09-08T20:00:00+03:00");
  assert.equal(out[0].group, "F.02");
});

test("changes move, cancel or add a class", () => {
  const cfg = {
    day: "Tue", time: "19:00",
    changes: [
      { date: "2026-09-15", to: "2026-09-17T20:00", note: "tutor ill" },
      { date: "2026-09-22", cancelled: true },
      { date: "2026-09-25", to: "2026-09-25T18:00" },
    ],
  };
  const out = buildClasses({ code: "X1", cfg, weeks });
  const moved = out.find((c) => c.status === "moved");
  assert.equal(moved?.at, "2026-09-17T20:00:00+03:00");
  assert.equal(moved?.movedFrom, "2026-09-15T19:00:00+03:00");
  assert.equal(moved?.note, "tutor ill");
  assert.equal(out.find((c) => c.at.startsWith("2026-09-22"))?.status, "cancelled");
  const extra = out.find((c) => c.status === "extra");
  assert.equal(extra?.weekIndex, 3);
  assert.equal(out.length, 4);
});

test("overlapping week ranges give one class, in the later week", () => {
  const ws = [
    { index: 1, name: "28 November - 4 December", start: "2026-11-28", end: "2026-12-04" },
    { index: 2, name: "2 December - 8 December", start: "2026-12-02", end: "2026-12-08" },
  ];
  const out = buildClasses({ code: "X1", cfg: { day: "Thu", time: "18:00" }, weeks: ws });
  assert.equal(out.length, 1);
  assert.equal(out[0].weekIndex, 2);
});

test("meeting agendas in the General section attach to the matching class", () => {
  const general = [
    { title: "Forum attachment: Webconference 2 Meeting Agenda", href: "/files/s/a2.pdf", ext: "pdf" },
    { title: "Syllabus", href: "/files/s/syl.pdf", ext: "pdf" },
  ];
  const out = buildClasses({ code: "X1", cfg: { day: "Tue" }, weeks, general });
  assert.deepEqual(out[1].extras, [{ title: "Webconference 2 Meeting Agenda", href: "/files/s/a2.pdf", ext: "pdf" }]);
  assert.deepEqual(out[0].extras, []);
});
