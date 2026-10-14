import { it, expect } from "vitest";
import {
  CsvBuffer,
  EXPORT_BYTE_LIMIT,
} from "../../packages/exports/src/csv.js";
it("counts actual UTF-8 bytes and refuses partial output after exceeding the explicit64MiB ceiling", () => {
  expect(EXPORT_BYTE_LIMIT).toBe(64 * 1024 * 1024);
  const csv = new CsvBuffer(9);
  csv.append("\uFEFF");
  csv.append("中文");
  expect(csv.finish().length).toBe(9);
  expect(() => csv.append("x")).toThrow("EXPORT_TOO_LARGE");
  expect(() => csv.finish()).toThrow("EXPORT_TOO_LARGE");
  const ascii = new CsvBuffer(3);
  ascii.append("a");
  ascii.append("bc");
  expect(ascii.finish().toString()).toBe("abc");
});
