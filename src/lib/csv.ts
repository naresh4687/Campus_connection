import { parse } from "csv-parse/sync";

export const CSV_LIMITS = { bytes: 2 * 1024 * 1024, rows: 5000, columns: 30, cell: 500 } as const;

export class CsvError extends Error {}

/**
 * Neutralises spreadsheet formula injection: a cell that begins with = + - @ (or a tab / carriage return) is prefixed with a
 * single quote so Excel/Sheets/LibreOffice show it as text instead of evaluating it. Then applies standard CSV quoting.
 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

/** Parses an uploaded student CSV. Throws CsvError with a message safe to show to the user. */
export function parseCsv(buf: Uint8Array): { headers: string[]; rows: string[][] } {
  if (buf.byteLength === 0) throw new CsvError("The file is empty.");
  if (buf.byteLength > CSV_LIMITS.bytes) throw new CsvError(`The file is larger than ${CSV_LIMITS.bytes / 1024 / 1024} MB.`);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    throw new CsvError("The file is not valid UTF-8 text. Save it as “CSV UTF-8” and try again.");
  }
  if (text.includes("\u0000")) throw new CsvError("The file looks like a binary file, not a CSV.");
  let records: string[][];
  try {
    records = parse(text, { bom: true, relax_column_count: true, skip_empty_lines: true, delimiter: [",", ";", "\t"], trim: true, max_record_size: 20_000 });
  } catch (e) {
    throw new CsvError(`The file could not be read as CSV (${(e as { code?: string }).code ?? "parse error"}).`);
  }
  if (records.length < 2) throw new CsvError("The file needs a header row and at least one data row.");
  const headers = records[0].map((h) => h.trim());
  if (headers.length > CSV_LIMITS.columns) throw new CsvError(`The file has more than ${CSV_LIMITS.columns} columns.`);
  if (headers.every((h) => h === "")) throw new CsvError("The header row is empty.");
  const rows = records.slice(1);
  if (rows.length > CSV_LIMITS.rows) throw new CsvError(`The file has more than ${CSV_LIMITS.rows} data rows. Split it into smaller files.`);
  const width = headers.length;
  const out: string[][] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.length > width && r.slice(width).some((c) => c !== "")) throw new CsvError(`Row ${i + 2} has more values than there are columns.`);
    const cells = Array.from({ length: width }, (_, c) => r[c] ?? "");
    for (const c of cells) if (c.length > CSV_LIMITS.cell) throw new CsvError(`Row ${i + 2} has a value longer than ${CSV_LIMITS.cell} characters.`);
    out.push(cells);
  }
  return { headers, rows: out };
}
