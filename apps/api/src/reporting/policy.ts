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
