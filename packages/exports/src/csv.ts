// Spreadsheet applications can interpret untrusted cells as formulas even after
// whitespace/control prefixes. Quote every cell and neutralize that prefix.
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const first = [...text].find(
    (character) => character.charCodeAt(0) > 32 && character.trim().length > 0,
  );
  const safe = first && "=+@-".includes(first) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function csvDocument(headers: string[], rows: unknown[][]): string {
  return (
    "\uFEFF" +
    [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") +
    "\r\n"
  );
}

export const EXPORT_BYTE_LIMIT = 67_108_864;
// Byte accounting includes UTF-8 expansion, BOM, quoting and line endings.
// A failed buffer never yields a partial CSV disguised as a complete export.
export class CsvBuffer {
  private chunks: Buffer[] = [];
  private bytes = 0;
  private failed = false;
  constructor(private readonly limit = EXPORT_BYTE_LIMIT) {
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new Error("INVALID_EXPORT_LIMIT");
  }
  append(text: string) {
    const chunk = Buffer.from(text, "utf8");
    if (this.failed || this.bytes + chunk.length > this.limit) {
      this.failed = true;
      this.chunks = [];
      throw new Error("EXPORT_TOO_LARGE");
    }
    this.bytes += chunk.length;
    this.chunks.push(chunk);
  }
  finish() {
    if (this.failed) throw new Error("EXPORT_TOO_LARGE");
    return Buffer.concat(this.chunks, this.bytes);
  }
}
