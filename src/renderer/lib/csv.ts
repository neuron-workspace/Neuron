// Reading and writing CSV files without changing what was not edited.
//
// A CSV here is someone's data file that other programs also read, so the
// writer reproduces the file's own conventions (delimiter, line end, BOM,
// quoting, final newline). `parseCsv` reports whether writing the parsed
// content back would give the same bytes; when it would not, the file is never
// written until the person edits it.

export type CsvDelimiter = ',' | ';' | '\t';
export type CsvLineEnd = '\r\n' | '\n' | '\r';

export interface CsvDialect {
  delimiter: CsvDelimiter;
  lineEnd: CsvLineEnd;
  bom: boolean;
  /** Every field in the file was quoted, so new fields are too. */
  quoteAll: boolean;
  finalNewline: boolean;
}

export interface CsvParseResult {
  /** Header names made unique and non-empty, for display and as column keys. */
  headers: string[];
  /** Header names exactly as the file has them, padded to the row width. */
  rawHeaders: string[];
  /** Every row has exactly `headers.length` cells. */
  rows: string[][];
  dialect: CsvDialect;
  /** Writing `rawHeaders` and `rows` back with `dialect` gives the original text. */
  exact: boolean;
}

/** How a table Neuron creates is written: LF, no BOM, a final newline. */
export const NEW_TABLE_DIALECT: CsvDialect = { delimiter: ',', lineEnd: '\n', bom: false, quoteAll: false, finalNewline: true };

export const CSV_MAX_BYTES = 5 * 1024 * 1024;
export const CSV_MAX_ROWS = 50_000;

interface RawRecord {
  fields: string[];
  quoted: boolean[];
  /** An empty line: one unquoted, empty field. */
  blank: boolean;
}

interface Scan {
  records: RawRecord[];
  lineEnd: CsvLineEnd | null;
  finalNewline: boolean;
}

/**
 * Splits text into records. Malformed input never loses characters: text after
 * a closing quote is kept in the field, and an unclosed quote runs to the end.
 */
function scan(text: string, start: number, delimiter: string, limit = Infinity): Scan {
  const records: RawRecord[] = [];
  const n = text.length;
  let lineEnd: CsvLineEnd | null = null;
  let finalNewline = false;
  let i = start;
  if (i >= n) return { records, lineEnd, finalNewline };
  let fields: string[] = [];
  let quoted: boolean[] = [];
  for (;;) {
    let value = '';
    let wasQuoted = false;
    if (text.charCodeAt(i) === 34) {
      wasQuoted = true;
      i++;
      for (;;) {
        const q = text.indexOf('"', i);
        if (q === -1) { value += text.slice(i); i = n; break; }
        value += text.slice(i, q);
        if (text.charCodeAt(q + 1) === 34) { value += '"'; i = q + 2; } else { i = q + 1; break; }
      }
      let j = i;
      while (j < n) { const c = text[j]; if (c === delimiter || c === '\n' || c === '\r') break; j++; }
      value += text.slice(i, j);
      i = j;
    } else {
      let j = i;
      while (j < n) { const c = text[j]; if (c === delimiter || c === '\n' || c === '\r') break; j++; }
      value = text.slice(i, j);
      i = j;
    }
    fields.push(value);
    quoted.push(wasQuoted);
    if (i >= n) {
      records.push({ fields, quoted, blank: fields.length === 1 && value === '' && !wasQuoted });
      break;
    }
    if (text[i] === delimiter) { i++; continue; }
    const end: CsvLineEnd = text[i] === '\r' ? (text[i + 1] === '\n' ? '\r\n' : '\r') : '\n';
    if (lineEnd === null) lineEnd = end;
    i += end.length;
    records.push({ fields, quoted, blank: fields.length === 1 && value === '' && !wasQuoted });
    fields = [];
    quoted = [];
    if (i >= n) { finalNewline = true; break; }
    if (records.length >= limit) break;
  }
  return { records, lineEnd, finalNewline };
}

/**
 * The delimiter that splits the first 20 records into the same number of
 * fields (more than one); the most fields wins, then `,` `;` tab in that order.
 */
export function detectDelimiter(text: string): CsvDelimiter {
  const start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let best: CsvDelimiter = ',';
  let bestScore = 0;
  let fallback: CsvDelimiter = ',';
  let fallbackScore = 0;
  for (const delimiter of [',', ';', '\t'] as const) {
    const records = scan(text, start, delimiter, 20).records.filter((record) => !record.blank);
    if (!records.length) continue;
    const width = records[0].fields.length;
    if (width > 1 && records.every((record) => record.fields.length === width) && width > bestScore) {
      best = delimiter;
      bestScore = width;
    }
    const split = records.filter((record) => record.fields.length > 1).length;
    if (split > fallbackScore) { fallback = delimiter; fallbackScore = split; }
  }
  return bestScore ? best : fallback;
}

/**
 * Header names for display and as metadata keys: an empty name becomes
 * `Column N` (its position), a repeated one `Name (2)`. The file keeps its own
 * names until the next write.
 */
export function uniqueHeaders(raw: readonly string[]): string[] {
  const reserved = new Set(raw.filter((name) => name.trim() !== ''));
  const used = new Set<string>();
  return raw.map((name, index) => {
    const empty = name.trim() === '';
    const base = empty ? `Column ${index + 1}` : name;
    let candidate = base;
    if (empty ? reserved.has(candidate) || used.has(candidate) : used.has(candidate)) {
      let k = 2;
      do candidate = `${base} (${k++})`; while (reserved.has(candidate) || used.has(candidate));
    }
    used.add(candidate);
    return candidate;
  });
}

export function parseCsv(text: string): CsvParseResult {
  const bom = text.charCodeAt(0) === 0xfeff;
  const delimiter = detectDelimiter(text);
  const { records, lineEnd, finalNewline } = scan(text, bom ? 1 : 0, delimiter);
  let width = 0;
  for (const record of records) if (record.fields.length > width) width = record.fields.length;
  // An empty line carries no data. In a one-column file it is an empty value;
  // elsewhere it is dropped, and `exact` turns false so nothing is written for it.
  const kept = width > 1 ? records.filter((record) => !record.blank) : records;
  const pad = (fields: string[]) => (fields.length < width ? [...fields, ...Array<string>(width - fields.length).fill('')] : fields);
  const rawHeaders = kept.length ? pad(kept[0].fields) : [];
  const rows = kept.slice(1).map((record) => pad(record.fields));
  const quoteAll = kept.length > 0 && kept.every((record) => record.quoted.every(Boolean));
  const dialect: CsvDialect = { delimiter, lineEnd: lineEnd ?? '\n', bom, quoteAll, finalNewline };
  return {
    headers: uniqueHeaders(rawHeaders),
    rawHeaders,
    rows,
    dialect,
    exact: serializeCsv(rawHeaders, rows, dialect) === text,
  };
}

function needsQuotes(value: string, delimiter: string): boolean {
  return value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r')
    || /^[ \t]|[ \t]$/.test(value);
}

export function serializeCsv(headers: readonly string[], rows: readonly (readonly string[])[], dialect: CsvDialect): string {
  const prefix = dialect.bom ? '﻿' : '';
  if (!headers.length && !rows.length) return prefix;
  const { delimiter, quoteAll } = dialect;
  const field = (value: string) => (quoteAll || needsQuotes(value, delimiter) ? `"${value.replace(/"/g, '""')}"` : value);
  const line = (cells: readonly string[]) => {
    const all = cells.length >= headers.length ? cells : [...cells, ...Array<string>(headers.length - cells.length).fill('')];
    // A lone empty field would be an empty line, which readers skip.
    if (all.length === 1 && all[0] === '') return '""';
    return all.map(field).join(delimiter);
  };
  const lines = [line(headers), ...rows.map(line)];
  return prefix + lines.join(dialect.lineEnd) + (dialect.finalNewline ? dialect.lineEnd : '');
}

/** UTF-8 size of a string, without allocating its bytes. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) { bytes += 4; i++; }
    else bytes += 3;
  }
  return bytes;
}

export const exceedsCsvBytes = (bytes: number) => bytes > CSV_MAX_BYTES;
export const exceedsCsvRows = (rows: number) => rows > CSV_MAX_ROWS;

/**
 * Text read as UTF-8 that was not: the reader replaced bytes it could not
 * decode, so writing it back would change characters the person never touched.
 */
export const notUtf8 = (text: string) => text.includes('\uFFFD') || text.includes('\u0000');

/** Why a file can only be read, or null when Neuron may manage it. */
export function csvReadOnlyReason(text: string, rowCount: number): string | null {
  if (notUtf8(text)) return 'This file is not UTF-8 text, so it opens read-only to keep its characters as they are.';
  if (exceedsCsvBytes(utf8Length(text))) return 'This CSV is larger than 5 MB, so it opens read-only.';
  if (exceedsCsvRows(rowCount)) return 'This CSV has more than 50,000 rows, so it opens read-only.';
  return null;
}
