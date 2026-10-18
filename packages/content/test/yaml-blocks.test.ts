// LaTeX in a note's or prep pack's YAML blocks, read as the author wrote it.
import test from "node:test";
import assert from "node:assert/strict";
import YAML from "yaml";
import { hasQuotedLatex, parseBlock, singleQuoteLatex } from "../src/yaml-blocks.ts";

test("LaTeX in double quotes is read with its backslashes", () => {
  // the prep pack that broke: "\m" is not a YAML escape
  const raw = `title: Sensitivity\ntex: "d' = z(\\mathrm{hit\\ rate}) - z(\\mathrm{false\\ alarm\\ rate})"`;
  assert.throws(() => YAML.parse(raw));
  assert.equal(parseBlock(YAML, raw).tex, "d' = z(\\mathrm{hit\\ rate}) - z(\\mathrm{false\\ alarm\\ rate})");
  // "\tau" parses, but as a tab: it must still come out as \tau
  assert.equal(YAML.parse('tex: "\\tau = RC"').tex, "\tau = RC");
  assert.equal(parseBlock(YAML, 'tex: "\\tau = RC"').tex, "\\tau = RC");
  assert.deepEqual(parseBlock(YAML, 'where:\n  - ["\\alpha", angle]').where, [["\\alpha", "angle"]]);
  assert.equal(parseBlock(YAML, 'tex: "\\\\alpha"').tex, "\\alpha");   // already escaped properly: as YAML reads it
});

test("everything else parses as before", () => {
  const ok = "tex: '\\frac{a}{b}'\nnote: \"Plain text, no maths\"\nmore: \"say \\\"hi\\\" (\\u00e9)\"";
  assert.equal(hasQuotedLatex(ok), false);
  assert.deepEqual(parseBlock(YAML, ok), YAML.parse(ok));
  assert.equal(singleQuoteLatex(ok), ok);
  assert.throws(() => parseBlock(YAML, "a: [unclosed"));
});
