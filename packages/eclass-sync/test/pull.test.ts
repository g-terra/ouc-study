// The pull's class videos (src/pull.ts): a video on a page downloads with the course files, a Panopto
// link stays a link and gets its captions as the transcript when they are shared. Made-up course, fake eClass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pull, textCopies } from "../src/pull.ts";
import type { MoodleClient, MoodleSection } from "../src/moodle.ts";
import type { SemesterConfig } from "../../content/src/eclass.ts";

const ID = "9d17f2bb-dc78-4c38-a97d-b1f000c50ef2";
const cfg: SemesterConfig = { label: "Test", start: "2026-09-01", end: "2027-01-31", courses: [{ code: "ABC101", title: "Testing", short: "Testing", color: "#000", eclassId: 7, dir: "ABC101-Testing" }] } as SemesterConfig;
const sections: MoodleSection[] = [{
  section: 1, name: "Week 1", summary: "", modules: [
    { id: 11, name: "Video 1: What is testing?", modname: "page", url: "https://e/mod/page/view.php?id=11", contents: [
      { type: "file", filename: "index.html", filesize: 50, fileurl: "https://e/pluginfile.php/1/mod_page/content/index.html", timemodified: 1 },
      { type: "file", filename: "What is testing.mp4", filesize: 4, fileurl: "https://e/pluginfile.php/1/mod_page/content/What%20is%20testing.mp4", timemodified: 1, mimetype: "video/mp4" },
    ] },
    { id: 12, name: "Lecture 2 - Fall 2024 recording", modname: "url", url: "https://e/mod/url/view.php?id=12", contents: [
      { type: "url", filename: "", filesize: 0, fileurl: `https://video.example.cy/Panopto/Pages/Viewer.aspx?id=${ID}`, timemodified: 1 },
    ] },
  ],
}];

function fakeClient() {
  const downloads: string[] = [];
  const client = {
    site: "https://e",
    call: (async (fn: string) => (fn === "core_course_get_contents" ? sections : fn === "mod_assign_get_assignments" ? { courses: [] } : {})) as MoodleClient["call"],
    getText: async () => `<video controls><source src="What%20is%20testing.mp4"></video>`,
    download: async (url: string, dest: string) => { downloads.push(url); mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, "fake"); return 4; },
  } as MoodleClient;
  return { client, downloads };
}
const SRT = "1\n00:00:00,000 --> 00:00:02,000\nWelcome back.\n";
const answers = (body: string, status = 200) => (async () => new Response(body, { status })) as typeof fetch;

function setup(media?: object) {
  const root = mkdtempSync(join(tmpdir(), "ouc-pull-"));
  mkdirSync(join(root, "semesters/T"), { recursive: true });
  if (media) { mkdirSync(join(root, ".ouc")); writeFileSync(join(root, ".ouc/media.json"), JSON.stringify(media)); }
  return root;
}
const meta = (root: string) => JSON.parse(readFileSync(join(root, "semesters/T/_meta/eclass-meta.json"), "utf8"))[0].secs[0].acts;

test("a video on a page downloads into the week, and the page points to it", async () => {
  const root = setup();
  const { client, downloads } = fakeClient();
  const r = await pull({ root, semId: "T", cfg, client, fetchImpl: answers(SRT) });
  const rel = "courses/ABC101-Testing/01-Week-1/Video-1-What-is-testing/What is testing.mp4";
  assert.ok(existsSync(join(root, "semesters/T", rel)));
  assert.deepEqual(downloads, ["https://e/pluginfile.php/1/mod_page/content/What%20is%20testing.mp4"]);
  const [page, link] = meta(root);
  assert.equal(page.local, "ABC101/01/Video-1-What-is-testing/What is testing.mp4");
  assert.equal(link.target, `https://video.example.cy/Panopto/Pages/Viewer.aspx?id=${ID}`);
  assert.equal(link.transcript, "ABC101/01/Lecture-2---Fall-2024-recording.transcript.md");
  assert.deepEqual(r.videos, { files: 1, panopto: 1, captions: 1, signin: 0 });
  const t = readFileSync(join(root, "semesters/T/courses/ABC101-Testing/01-Week-1/Lecture-2---Fall-2024-recording.transcript.md"), "utf8");
  assert.match(t, /by: "Panopto captions"/);
  assert.match(t, /\[0:00\] Welcome back\./);
});

test("Panopto asking to sign in: no transcript, counted; videos off: the page stays a link", async () => {
  const root = setup({ videos: false });
  const { client, downloads } = fakeClient();
  const r = await pull({ root, semId: "T", cfg, client, fetchImpl: answers("", 302) });
  assert.deepEqual(downloads, []);
  assert.equal(meta(root)[0].local, undefined);
  assert.deepEqual(r.videos, { files: 0, panopto: 1, captions: 0, signin: 1 });
  assert.ok(!existsSync(join(root, "semesters/T/courses/ABC101-Testing/01-Week-1/Lecture-2---Fall-2024-recording.transcript.md")));
});

test("a dry run lists the video and asks Panopto nothing", async () => {
  const root = setup();
  const { client } = fakeClient();
  let asked = 0;
  const r = await pull({ root, semId: "T", cfg, client, dryRun: true, fetchImpl: (async () => { asked++; return new Response(SRT); }) as typeof fetch });
  assert.deepEqual(r.files.toDownload, ["courses/ABC101-Testing/01-Week-1/Video-1-What-is-testing/What is testing.mp4"]);
  assert.equal(asked, 0);
  assert.match(readFileSync(join(root, ".ouc/dry-run/T/report.md"), "utf8"), /Class videos to download: 1; Panopto recordings \(links only\): 1/);
});

test("links in an activity's description, an exam timetable's too, are not downloaded (exam dates are added by hand)", async () => {
  const root = setup({ videos: false });
  const desc = `<p>Join the class here.</p><p><a href="https://e/pluginfile.php/9/mod_webconference/intro/Exam-Timetable-2026-2027.pdf">View the examination timetable</a>`
    + ` · <a href="https://e/pluginfile.php/9/mod_webconference/intro/Guide.pdf">How to join</a> · <a href="https://elsewhere.example/timetable.pdf">Other timetable</a></p>`;
  const general: MoodleSection[] = [{ section: 0, name: "General", summary: "", modules: [
    { id: 21, name: "Webconference", modname: "webconference", url: "https://e/mod/webconference/view.php?id=21", description: desc, contents: [] },
  ] }];
  const downloads: string[] = [];
  const client = {
    site: "https://e",
    call: (async (fn: string) => (fn === "core_course_get_contents" ? general : fn === "mod_assign_get_assignments" ? { courses: [] } : {})) as MoodleClient["call"],
    getText: async () => "",
    download: async (url: string, dest: string) => { downloads.push(url); mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, "pdf"); return 3; },
  } as MoodleClient;
  await pull({ root, semId: "T", cfg, client, fetchImpl: answers("") });
  assert.deepEqual(downloads, []);
  assert.ok(!existsSync(join(root, "semesters/T/courses/ABC101-Testing/00-General/Exam-Timetable-2026-2027.pdf")));
});

test("after new files, the text copies are made for the AI to read", () => {
  const calls: string[][] = [];
  const run = (cmd: string, args: string[]) => { calls.push([cmd, ...args]); return { status: 0 }; };
  assert.equal(textCopies("/r", "2026-Fall", { run, python: "python3" }), true);
  assert.deepEqual(calls, [["python3", "tools/extract_text.py", "2026-Fall"]]);
  assert.equal(textCopies("/r", "2026-Fall", { run, python: null }), false);   // no Python: skipped
  assert.equal(textCopies("/r", "2026-Fall", { run: () => ({ status: 1 }), python: "python" }), false);
});

test("an assignment whose eClass name has an HTML entity gets the folder the app looks in (& decoded, not \"amp\")", async () => {
  const root = setup({ videos: false });
  const due = Math.floor(new Date(2026, 9, 7, 21, 59).getTime() / 1000);
  const week: MoodleSection[] = [{ section: 1, name: "Week 1", summary: "", modules: [
    { id: 31, name: "Assignment 1 &amp; 2: Finding a Paper", modname: "assign", url: "https://e/mod/assign/view.php?id=31", contents: [] },
  ] }];
  const client = {
    site: "https://e",
    call: (async (fn: string) => (fn === "core_course_get_contents" ? week
      : fn === "mod_assign_get_assignments" ? { courses: [{ id: 7, assignments: [{ id: 5, cmid: 31, name: "Assignment 1 &amp; 2: Finding a Paper", duedate: due }] }] } : {})) as MoodleClient["call"],
    getText: async () => "",
    download: async (_url: string, dest: string) => { mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, "x"); return 1; },
  } as MoodleClient;
  await pull({ root, semId: "T", cfg, client, fetchImpl: answers("") });
  assert.equal(meta(root)[0].folder, "assignments/ABC101/10-07_Assignment-1-2-Finding-a-Paper");
});
