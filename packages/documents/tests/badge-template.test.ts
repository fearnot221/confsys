import { it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import QRCode from "qrcode";
import { badgeTemplateDocument, badgeJobSnapshot } from "@confsys/contracts";
import { renderBadges } from "../src/index.js";
const badge = {
  conferenceName: "合成研討會",
  name: "陳怡君",
  affiliation: "合成研究所",
  registrationNumber: "123",
};
it("bounded templates reject unknown layouts, control text, and unsupported sizes", () => {
  const template = {
    size: "large",
    layout: "centered",
    showAffiliation: true,
    showRegistrationNumber: true,
    footer: "歡迎參加",
  };
  expect(badgeTemplateDocument.safeParse(template).success).toBe(true);
  for (const change of [
    { size: "custom" },
    { layout: "<script>" },
    { footer: "a\nb" },
    { footer: "a".repeat(121) },
    { html: "<b>hi</b>" },
  ])
    expect(
      badgeTemplateDocument.safeParse({ ...template, ...change }).success,
    ).toBe(false);
  expect(
    badgeJobSnapshot.safeParse({ conferenceName: "Synthetic", badges: [] })
      .success,
  ).toBe(false);
});
it("configured PDF page dimensions are real and legacy badge pages retain original dimensions", async () => {
  const qrPng = await QRCode.toBuffer("CONFSYS_TEMPLATE_PREVIEW_NOT_A_PASS");
  for (const size of ["credit_card", "large"] as const) {
    const bytes = await renderBadges([{ ...badge, qrPng }], {
      size,
      layout: "centered",
      showAffiliation: true,
      showRegistrationNumber: true,
      footer: "歡迎參加",
    });
    const pdf = await PDFDocument.load(bytes),
      page = pdf.getPage(0);
    expect(page.getWidth()).toBeCloseTo(
      ((size === "credit_card" ? 86 : 100) * 72) / 25.4,
      3,
    );
    expect(page.getHeight()).toBeCloseTo(
      ((size === "credit_card" ? 54 : 140) * 72) / 25.4,
      3,
    );
  }
  const pdf = await PDFDocument.load(await renderBadges([badge]));
  expect(pdf.getPage(0).getHeight()).toBe(425.2);
  await expect(
    renderBadges([badge], {
      size: "credit_card",
      layout: "left",
      showAffiliation: true,
      showRegistrationNumber: true,
      footer: "長".repeat(120),
    }),
  ).rejects.toThrow("printable area");
});
