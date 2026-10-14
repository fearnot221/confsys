import { it, expect } from "vitest";
import {
  siteDocumentSchema,
  siteSaveInput,
  siteIssues,
  safeSiteLink,
} from "@confsys/contracts";
import { completeSite } from "../helpers/site.js";
it("validates date-only, timezone, language metadata and bounded strict documents", () => {
  const d = completeSite();
  expect(siteIssues(d, true)).toEqual([]);
  for (const [key, value] of [
    ["startDate", "2027-02-29"],
    ["endDate", "2020-01-01"],
    ["timezone", "Mars/Base"],
    ["contactEmail", "invalid"],
  ])
    expect(
      siteIssues({ ...d, [key as string]: value }, true).length,
    ).toBeGreaterThan(0);
  d.translations.en.pages.about.title = "";
  expect(siteIssues(d, true)).toContain("en.about: title 與 description 必填");
  expect(
    siteSaveInput.safeParse({
      expectedVersion: 0,
      document: d,
      publishedBy: "attacker",
    }).success,
  ).toBe(false);
  expect(
    siteDocumentSchema.safeParse({ ...d, SMTP_FROM: "attacker" }).success,
  ).toBe(false);
  expect(
    siteDocumentSchema.safeParse({ ...d, phone: "x".repeat(51) }).success,
  ).toBe(false);
});
it("rejects script/data/protocol-relative/userinfo/backslash links without fetching URLs", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,test",
    "//evil.invalid",
    "https://u:p@evil.invalid",
    "https:\\evil.invalid",
    "/auth/reset",
    "/en/missing",
  ])
    expect(safeSiteLink(url), url).toBe(false);
  expect(safeSiteLink("https://example.invalid/path?q=1&x=2")).toBe(true);
  expect(safeSiteLink("/en/about")).toBe(true);
});
