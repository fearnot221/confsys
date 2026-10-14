import { expect, it } from "vitest";
import {
  money,
  renderReceipt,
  renderBadges,
} from "../../apps/api/src/documents/pdf.js";
import { validatePdf } from "../../apps/api/src/files/pdf-validation.js";
import type { ReceiptSnapshot } from "@confsys/contracts";
const snapshot: ReceiptSnapshot = {
  schemaVersion: 1,
  conferenceName: "合成研討會",
  number: "R-00000001",
  revision: 1,
  issuedAt: "2026-10-15T00:00:00.000Z",
  registrationNumber: "1",
  attendeeName: "陳怡君",
  amount: "150000",
  currency: "TWD",
  buyerName: "合成研究所",
  buyerTaxId: "",
  buyerAddress: "臺北市",
  items: [{ description: "一般報名", amount: "150000" }],
};
it("PDF money display preserves exact minor units for zero/two/three-decimal currencies", () => {
  expect(money("150000", "TWD")).toBe("TWD 1500.00");
  expect(money("123", "JPY")).toBe("JPY 123");
  expect(money("1234", "KWD")).toBe("KWD 1.234");
  expect(money("999999999999", "USD")).toBe("USD 9999999999.99");
});
it("real embedded CJK receipt and badge batch are valid PDFs; oversized badge copy fails explicitly", async () => {
  const receipt = await renderReceipt(snapshot, "void");
  await expect(validatePdf(receipt)).resolves.toBeUndefined();
  const badges = await renderBadges([
    {
      conferenceName: snapshot.conferenceName,
      name: snapshot.attendeeName,
      affiliation: snapshot.buyerName,
      registrationNumber: "1",
    },
  ]);
  await expect(validatePdf(badges)).resolves.toBeUndefined();
  await expect(
    renderBadges([
      {
        conferenceName: "研".repeat(160),
        name: "陳怡君",
        affiliation: "研究所",
        registrationNumber: "1",
      },
    ]),
  ).rejects.toThrow("printable area");
  await expect(renderBadges([])).rejects.toThrow("1 to 200");
  await expect(
    renderReceipt({ ...snapshot, buyerName: "unsupported 🦄" }, "issued"),
  ).rejects.toThrow("unsupported glyph");
});
