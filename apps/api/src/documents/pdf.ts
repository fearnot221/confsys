import { readFile } from "node:fs/promises";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { ReceiptSnapshot } from "@confsys/contracts";

let fontBytes: Promise<Buffer> | undefined;
function font() {
  return fontBytes ??= readFile(new URL("../../assets/fonts/ConfsysSansTC-Regular.ttf", import.meta.url));
}
export function money(amount: string, currency: string) {
  const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const value = BigInt(amount), divisor = 10n ** BigInt(digits);
  return `${currency} ${(value / divisor).toString()}${digits ? `.${(value % divisor).toString().padStart(digits, "0")}` : ""}`;
}
const characterSets = new WeakMap<PDFFont, Set<number>>();
function wrap(text: string, typeface: PDFFont, size: number, width: number) {
  let supported = characterSets.get(typeface);
  if (!supported) { supported = new Set(typeface.getCharacterSet()); characterSets.set(typeface, supported); }
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const character of paragraph) {
      if (!supported.has(character.codePointAt(0)!)) throw new Error("Document text contains an unsupported glyph");
      if (typeface.widthOfTextAtSize(line + character, size) > width && line) { lines.push(line); line = ""; }
      line += character;
    }
    lines.push(line);
  }
  return lines;
}
export async function renderReceipt(snapshot: ReceiptSnapshot, state: "issued" | "void") {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  // Full embedding is intentional: current fontkit subset drops composite CJK outlines.
  const typeface = await document.embedFont(await font(), { subset: false });
  document.setTitle(`收據 ${snapshot.number} 第 ${snapshot.revision} 版`);
  document.setCreator("Confsys receipt renderer v1");
  document.setCreationDate(new Date(snapshot.issuedAt));
  document.setModificationDate(new Date(snapshot.issuedAt));
  const pages: PDFPage[] = [];
  let page: PDFPage, y = 0;
  const newPage = () => {
    page = document.addPage([595.28, 841.89]); pages.push(page); y = 787;
    page.drawRectangle({ x: 42, y: 812, width: 511, height: 4, color: rgb(0.13, 0.27, 0.31) });
  };
  newPage();
  const write = (text: string, size = 11, space = 10) => {
    for (const line of wrap(text, typeface, size, 499)) {
      if (y < 85) newPage();
      page.drawText(line, { x: 48, y, size, font: typeface, color: rgb(0.1, 0.15, 0.18) });
      y -= size * 1.5;
    }
    y -= space;
  };
  write(snapshot.conferenceName, 20, 15);
  write(state === "void" ? "收據 - 已作廢 / VOID" : "收據 / RECEIPT", 17, 18);
  write(`收據號碼：${snapshot.number}    版本：${snapshot.revision}`);
  write(`發行時間：${snapshot.issuedAt}`);
  write(`抬頭：${snapshot.buyerName}`);
  if (snapshot.buyerTaxId) write(`統一編號／識別號：${snapshot.buyerTaxId}`);
  if (snapshot.buyerAddress) write(`地址：${snapshot.buyerAddress}`);
  write(`參加者：${snapshot.attendeeName}    報名編號：${snapshot.registrationNumber}`, 11, 18);
  write("費用明細", 14, 8);
  for (const item of snapshot.items) write(`${item.description}    ${money(item.amount, snapshot.currency)}`);
  write(`實收金額：${money(snapshot.amount, snapshot.currency)}`, 16, 22);
  write("本文件為研討會收款紀錄，不代表任何未經確認之法定電子發票。", 9, 6);
  write("重印沿用原收據號碼與發行快照；更正保留版本歷程。", 9, 6);
  for (let index = 0; index < pages.length; index++) {
    pages[index]!.drawText(`${snapshot.number}  /  ${index + 1} of ${pages.length}`, { x: 48, y: 42, size: 9, font: typeface, color: rgb(0.4, 0.45, 0.47) });
  }
  return Buffer.from(await document.save());
}
function fitBadgeText(text: string, typeface: PDFFont, initialSize: number, maxLines: number) {
  for (let size = initialSize; size >= 8; size--) {
    const lines = wrap(text, typeface, size, 240);
    if (lines.length <= maxLines) return { lines, size };
  }
  throw new Error("Badge text exceeds printable area; shorten display text");
}
export type BadgeSnapshot = { conferenceName: string; name: string; affiliation: string; registrationNumber: string; qrPng?: Uint8Array };
export async function renderBadges(badges: readonly BadgeSnapshot[]) {
  if (!badges.length || badges.length > 200) throw new Error("Badge batch must contain 1 to 200 records");
  const document = await PDFDocument.create(); document.registerFontkit(fontkit);
  const typeface = await document.embedFont(await font(), { subset: false });
  for (const badge of badges) {
    const page = document.addPage([283.46, 425.2]);
    page.drawRectangle({ x: 0, y: 365, width: 283.46, height: 60, color: rgb(0.13, 0.27, 0.31) });
    let y = 395;
    const heading = fitBadgeText(badge.conferenceName, typeface, 12, 2);
    for (const line of heading.lines) { page.drawText(line, { x: 22, y, font: typeface, size: heading.size, color: rgb(1, 1, 1) }); y -= heading.size * 1.5; }
    y = 315;
    const name = fitBadgeText(badge.name, typeface, 25, 4);
    for (const line of name.lines) { page.drawText(line, { x: 22, y, font: typeface, size: name.size }); y -= name.size * 1.4; }
    const affiliation = fitBadgeText(badge.affiliation, typeface, 12, 4);
    for (const line of affiliation.lines) {
      if (y < 175) throw new Error("Badge text overlaps QR area; shorten display text");
      page.drawText(line, { x: 22, y, font: typeface, size: affiliation.size }); y -= affiliation.size * 1.4;
    }
    if (badge.qrPng) { const qr = await document.embedPng(badge.qrPng); page.drawImage(qr, { x: 89, y: 50, width: 105, height: 105 }); }
    page.drawText(`報名編號 ${badge.registrationNumber}`, { x: 22, y: 22, font: typeface, size: 9 });
  }
  return Buffer.from(await document.save());
}
