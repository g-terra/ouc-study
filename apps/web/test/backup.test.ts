// The words Settings › Backup uses for the last backup.
import { test } from "node:test";
import assert from "node:assert/strict";
import { backupWhen, fileSize, statusLine } from "../src/lib/backup.ts";

const now = new Date(2026, 9, 22, 20, 0);

test("says when the last backup ran in the student's words", () => {
  assert.equal(backupWhen(new Date(2026, 9, 22, 18, 4).toISOString(), now), "today 18:04");
  assert.equal(backupWhen(new Date(2026, 9, 21, 22, 10).toISOString(), now), "yesterday 22:10");
  assert.equal(backupWhen(new Date(2026, 9, 2, 9, 0).toISOString(), now), "2 Oct");
});

test("sizes read in KB, MB or GB", () => {
  assert.equal(fileSize(900), "1 KB");
  assert.equal(fileSize(306 * 1024 * 1024), "306 MB");
  assert.equal(fileSize(1.25 * 1024 ** 3), "1.3 GB");
});

test("a good backup says when, how many files and how big; a failed one says why and when it last worked", () => {
  assert.equal(statusLine({ ok: true, at: new Date(2026, 9, 22, 18, 4).toISOString(), summary: "3 notes", files: 1214, bytes: 306 * 1024 * 1024 }, now),
    "Backed up today 18:04 · 1,214 files · 306 MB");
  assert.equal(statusLine({ ok: false, at: new Date(2026, 9, 22, 19, 0).toISOString(), summary: "", files: 0, bytes: 0, error: "GitHub sign-in expired. Sign in again.", lastGood: new Date(2026, 9, 21, 22, 10).toISOString() }, now),
    "The last backup didn't work: GitHub sign-in expired. Sign in again. The last good one was yesterday 22:10.");
  assert.equal(statusLine(null, now), "Not backed up yet");
});
