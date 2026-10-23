// What a running backup shows: which step, files done out of the total, and about how long is left.
import { test } from "node:test";
import assert from "node:assert/strict";
import { progressText, timeLeft, type BackupProgress } from "../src/progress.ts";

const at = (s: number) => new Date(Date.parse("2026-10-23T10:00:00Z") + s * 1000);
const p = (o: Partial<BackupProgress>): BackupProgress => ({ step: "saving", done: 0, total: 10, bytesDone: 0, bytesTotal: 0, startedAt: at(0).toISOString(), ...o });

test("time left comes from how fast it has gone so far, by size when known", () => {
  assert.equal(timeLeft(p({ bytesDone: 25, bytesTotal: 100 }), at(60)), 180);
  assert.equal(timeLeft(p({ done: 5, total: 10 }), at(30)), 30, "by files when sizes aren't known");
  assert.equal(timeLeft(p({ bytesDone: 1, bytesTotal: 100 }), at(60)), null, "too early to say");
  assert.equal(timeLeft(p({ bytesDone: 50, bytesTotal: 100 }), at(2)), null, "too soon after the start");
});

test("each step reads as a short line with files and time left", () => {
  assert.equal(progressText(p({ done: 120, total: 340, bytesDone: 50, bytesTotal: 100 }), at(120)), "Saving files: 120 of 340 · about 2 min left");
  assert.equal(progressText(p({ step: "compressing", done: 1, total: 3 }), at(600)), "Making smaller copies of class videos: 1 of 3 · about 20 min left");
  assert.equal(progressText(p({ step: "uploading", done: 90, total: 100 }), at(90)), "Uploading to the backup: 90% · less than a minute left");
  assert.equal(progressText(p({ done: 0, total: 5 }), at(1)), "Saving files: 0 of 5 · working out how long it takes…");
  assert.equal(progressText(p({ bytesDone: 10, bytesTotal: 100 }), at(3 * 3600)), "Saving files: 0 of 10 · about 27 h left");
  assert.equal(progressText(p({ bytesDone: 50, bytesTotal: 100 }), at(5400)), "Saving files: 0 of 10 · about 1 h 30 min left");
});
