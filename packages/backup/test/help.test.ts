// "How to get a token": both ways, with the commands and links a student needs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenHelp } from "../src/help.ts";

test("the help gives the gh way and the github.com way, with the clipboard command for the computer", () => {
  const [gh, web] = tokenHelp("windows");
  assert.match(gh.title, /GitHub CLI/);
  assert.ok(gh.steps.some((s) => s.command === "gh auth token | clip"));
  assert.ok(gh.steps.some((s) => s.command?.startsWith("winget install GitHub.cli")));
  assert.ok(tokenHelp("mac")[0].steps.some((s) => s.command === "gh auth token | pbcopy"));
  assert.ok(web.steps.some((s) => s.link?.startsWith("https://github.com/new?name=ouc-study-backup&visibility=private")));
  assert.ok(web.steps.some((s) => /Contents → Read and write/.test(s.text) && s.link?.includes("personal-access-tokens/new")));
  assert.equal(tokenHelp("linux").at(0)?.steps.at(-1)?.command, "gh auth token");
});
