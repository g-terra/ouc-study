// The app's small router: which route a path matches.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchPath } from "../src/lib/router.tsx";

test("a route matches a path with a query string, without the query in its params", () => {
  assert.deepEqual(matchPath("/print/homework/:sem/:code/:folder", "/print/homework/2026-Fall/COS511/a?name=X&pages=1"),
    { sem: "2026-Fall", code: "COS511", folder: "a" });
  assert.deepEqual(matchPath("/v2/:sem/courses/:code", "/v2/2026-Fall/courses/COS511#w3"), { sem: "2026-Fall", code: "COS511" });
});
