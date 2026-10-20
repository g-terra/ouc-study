import { test } from "node:test";
import assert from "node:assert/strict";
import type { Assignment, UpdateItem } from "@ouc/content/types";
import { assignmentFor } from "../src/lib/updateLink.ts";

const a = (id: string, fullTitle: string, eclassUrl?: string): Assignment => ({
  id, code: "ABC101", title: fullTitle.replace(/^Assignment /, "A"), fullTitle, status: "", submitted: true, question: "", weekIndex: 1, eclassUrl, briefs: [], submissions: [],
});
const list = [a("ABC101/10-01_Essay-1", "Essay 1", "https://eclass.ouc.ac.cy/mod/assign/view.php?id=70"), a("ABC101/10-15_Assignment-2", "Assignment 2")];
const u = (type: UpdateItem["type"], title: string, url = "", code = "ABC101"): UpdateItem => ({ type, code, title, detail: "", url, at: "" });

test("a grade, feedback, deadline or submission update finds its assignment", () => {
  assert.equal(assignmentFor(list, u("grade", "New grade: Assignment 2"))?.id, "ABC101/10-15_Assignment-2");
  assert.equal(assignmentFor(list, u("feedback", "Tutor feedback on Essay 1"))?.id, "ABC101/10-01_Essay-1");
  assert.equal(assignmentFor(list, u("feedback", "Feedback on  assignment 2"))?.id, "ABC101/10-15_Assignment-2");
  assert.equal(assignmentFor(list, u("deadline", "Deadline changed: Essay 1"))?.id, "ABC101/10-01_Essay-1");
  assert.equal(assignmentFor(list, u("submission", "Essay 1: submitted ✓"))?.id, "ABC101/10-01_Essay-1");
  // the eClass link wins over the name
  assert.equal(assignmentFor(list, u("grade", "New grade: Renamed on eClass", "https://eclass.ouc.ac.cy/mod/assign/view.php?id=70"))?.id, "ABC101/10-01_Essay-1");
});

test("other updates, other courses and unknown names find none", () => {
  assert.equal(assignmentFor(list, u("forum", "New post: Essay 1")), undefined);
  assert.equal(assignmentFor(list, u("grade", "New grade: Essay 1", "", "XYZ999")), undefined);
  assert.equal(assignmentFor(list, u("grade", "New grade: Course total")), undefined);
});
