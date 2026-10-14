import { it, expect } from "vitest";
import { loadConfig } from "@confsys/config";
it("fails closed on missing configuration without exposing secret values", () => {
  expect(() => loadConfig({ DATABASE_URL: "sensitive-not-a-url" })).toThrow(
    "Invalid environment fields",
  );
  try {
    loadConfig({ DATABASE_URL: "sensitive-not-a-url" });
  } catch (error) {
    expect(String(error)).not.toContain("sensitive-not-a-url");
  }
});
