import { it, expect } from "vitest";
import { csvCell, csvDocument } from "../../apps/api/src/reporting/policy.js";
it("quotes CSV and neutralizes formulas behind whitespace/control prefixes", () => {
  for (const value of [
    "=SUM(1,2)",
    "+1",
    "-1",
    "@SUM(A1)",
    " \t=1",
    "\r\n+1",
    "\u0000=1",
  ])
    expect(csvCell(value)).toBe(`"'${value.replaceAll('"', '""')}"`);
  expect(csvCell('normal, "quoted"\ntext')).toBe('"normal, ""quoted""\ntext"');
  expect(csvCell(null)).toBe('""');
  expect(csvCell("case@example.invalid")).toBe('"case@example.invalid"');
  expect(csvDocument(["a"], [["b"]])).toBe('\uFEFF"a"\r\n"b"\r\n');
});
