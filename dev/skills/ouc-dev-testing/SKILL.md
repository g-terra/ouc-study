---
name: ouc-dev-testing
description: Contributor only. Use when changing OUC Study's code and deciding what to test, where the test goes and how to run it (node:test unit tests, Playwright e2e on the demo semester). Not for studying.
---

# Testing OUC Study changes

TDD is mandatory here (stage 3 of the flow in `dev/CODING.md`). For every task in the plan:

1. **Red**: write the test for the next small behaviour. Run it and watch it fail for the right reason (an assertion about the missing behaviour, not a typo or import error).
2. **Green**: write the least code that makes it pass. Run it again.
3. **Refactor**: clean up the code and the test with everything green, then commit.

No production code without a failing test that asked for it. Wrote code first? Delete it and start from the test. Bug fixes start with a test that reproduces the bug.

## Pick the layer (decide it in the plan)

Test at the lowest layer that proves the behaviour, and add an e2e test only when the behaviour lives in the page.

| Changed | Test file | How |
|---|---|---|
| Pure logic in `apps/web/src/lib/*.ts`, `apps/web/src/v2/*.ts` | `apps/web/test/<topic>.test.ts` | Import the `.ts` file directly. It must not import React or touch the DOM, so keep logic out of components. |
| `packages/content` (build, search, quiz, plan, progress, grades) | `packages/content/test/` | Made-up `Course`/`Week` objects (`as unknown as Course` for partial shapes), `mkdtempSync(join(tmpdir(), …))` for files. |
| `packages/eclass-sync` | `packages/eclass-sync/test/` | A fake `MoodleClient` whose `call` returns made-up sections; never the network. |
| `packages/ai` (providers, `/api/ai`, review, slides, transcribe) | `packages/ai/test/` | `helpers.ts` (`portOf`, `json`, `zip` to build a .docx/.pptx), `fixtures/fake-agent.mjs` stands in for the agent CLIs. |
| `packages/backup` (what's backed up, git target, runs) | `packages/backup/test/` | Temp folders and a local bare repo (`git init --bare`) as the remote; never GitHub or Google. |
| `packages/cli` (`ouc`, setup, background, updates) | `packages/cli/test/` | Temp folders; never install, schedule or touch the real home folder. |
| A page, a component, navigation, a user flow | `e2e/<area>.spec.ts` | Playwright on `e2e/demo/2026-Demo` (made-up semester). |
| `ai/` skills or agents | `packages/ai/test/ai-folder.test.ts` already checks front matter | Add a test if you change how actions are built (`actions.test.ts`). |
| `dev/` contributor tooling | `packages/cli/test/dev-agents.test.ts` | |

## Unit tests (node:test)

```ts
// One line on what this file covers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { thing } from "../src/thing.ts";

test("says the behaviour in a sentence, as the student would see it", () => {
  assert.deepEqual(thing(input), expected);
});
```
- Name tests as sentences about behaviour, not about functions.
- Cover the edge that broke or could break: empty week, missing file, Windows path, a date across midnight in the student's timezone, Greek text.
- No sleeps or real clocks; pass dates in. No network: inject the client or start a local `http` server on port 0.
- Run one file or test while working: `node --import tsx --test packages/content/test/plan.test.ts`, or `npm test -- --test-name-pattern "plan"`.

## E2E tests (Playwright)

- Pages are served by `e2e/serve.ts` from a temp copy of `e2e/demo/`, so real semesters are never touched. Need more data? Add **made-up** files to `e2e/demo/2026-Demo` (documents under 50 KB) and check other specs still pass.
- Copy the `beforeEach`/`afterEach` from a sibling spec: it collects console errors and fails the test on any; set `localStorage` `ouc-tour-seen` to `1` unless you test the tour, and `ouc-ui` to `classic` for classic pages (the new look under `/v2/2026-Demo` is the default).
- Find elements by role and accessible name (`getByRole("button", { name: "Sync now" })`), not CSS classes. If you can't, the UI is missing a label: fix that.
- Mock the AI and anything slow with `page.route("**/api/ai/…", (r) => r.fulfill({ json: … }))`; no real agent runs in tests.
- Check a phone width (`page.setViewportSize({ width: 390, height: 800 })`) when the layout changes.
- Run: `npm run e2e`, or `npx playwright test -c e2e e2e/v2.spec.ts -g "settings"`. Chromium missing? Locally `npx playwright install chromium`. Elsewhere set `PLAYWRIGHT_CHROMIUM` to an installed Chrome (the cloud SessionStart hook does this).

## Done means

`npm run check` and `npm run build` pass, `npm run e2e` passes when the app changed, and you read the output. Never skip, `.only`, loosen or delete a test to get green; fix the cause.
