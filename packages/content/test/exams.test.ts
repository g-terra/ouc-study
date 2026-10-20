// Exams read from the exam timetable's text when _meta/exams.json is empty (made-up timetable lines).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findTimetableText, parseExamTimetable } from "../src/exams.ts";

const TEXT = `                    TIMETABLE 2026-2027
        Winter semester
        Module                     Final Exam                              Repeat Exam
          DEM 101                         5/12/2026                    13:00                           11/1/2027                         **
          DEM102                          8/12/2026                    9:30                            14/1/2027                         10:00
          OTH 101                         6/12/2026                    13:00                           12/1/2027                         **
          DEM 103                         19/12/2026
        Spring semester
          DEM 101                          8/5/2027                    13:00                           14/6/2027                         **
`;

test("picks this semester's lines for the semester's courses, with final and repeat exams", () => {
  const ex = parseExamTimetable(TEXT, ["DEM101", "DEM102", "DEM103"], "2026-09-07", "2027-01-17", "x.pdf");
  assert.deepEqual(ex, [
    { code: "DEM101", kind: "Final exam", at: "2026-12-05T13:00", source: "x.pdf" },
    { code: "DEM102", kind: "Final exam", at: "2026-12-08T09:30", source: "x.pdf" },
    { code: "DEM103", kind: "Final exam", at: "2026-12-19T00:00", notime: true, source: "x.pdf" },
    { code: "DEM101", kind: "Repeat exam", at: "2027-01-11T00:00", notime: true, source: "x.pdf" },
    { code: "DEM102", kind: "Repeat exam", at: "2027-01-14T10:00", source: "x.pdf" },
  ]);
});

test("the spring semester gets the spring lines", () => {
  const ex = parseExamTimetable(TEXT, ["DEM101"], "2027-02-01", "2027-06-01");
  assert.deepEqual(ex.map((e) => e.at), ["2027-05-08T13:00", "2027-06-14T00:00"]);
});

test("finds the timetable's text copy and the PDF it came from", () => {
  const dir = mkdtempSync(join(tmpdir(), "ouc-exams-"));
  mkdirSync(join(dir, "text/DEM101-Demo/00-General"), { recursive: true });
  writeFileSync(join(dir, "text/DEM101-Demo/00-General/Syllabus.pdf.txt"), "not this one");
  writeFileSync(join(dir, "text/DEM101-Demo/00-General/Exam-Timetable-2026-2027.pdf.txt"), TEXT);
  const t = findTimetableText(dir);
  assert.equal(t?.pdf, join("courses", "DEM101-Demo/00-General/Exam-Timetable-2026-2027.pdf"));
  assert.equal(t?.text, TEXT);
  assert.equal(findTimetableText(join(dir, "missing")), undefined);
});
