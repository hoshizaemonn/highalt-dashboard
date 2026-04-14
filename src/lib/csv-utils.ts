/**
 * CSV parsing utilities for handling Japanese encodings (utf-8-sig, utf-8, cp932/shift_jis).
 */

/**
 * Decode a file buffer trying multiple encodings.
 * Order: utf-8 (with BOM strip), shift_jis (cp932 superset).
 */
export function decodeFileBuffer(
  buffer: ArrayBuffer,
  preferredEncoding?: string,
): string {
  const encodings = preferredEncoding
    ? [preferredEncoding, "utf-8", "shift_jis"]
    : ["utf-8", "shift_jis"];

  for (const enc of encodings) {
    try {
      const decoder = new TextDecoder(enc, { fatal: true });
      let text = decoder.decode(buffer);
      // Strip BOM
      if (text.charCodeAt(0) === 0xfeff) {
        text = text.slice(1);
      }
      return text;
    } catch {
      continue;
    }
  }
  throw new Error("CSVのエンコーディングを判定できませんでした");
}

/**
 * Parse CSV text into rows (array of string arrays).
 * Handles quoted fields with commas and newlines.
 */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let inQuotes = false;
  let row: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(current.trim());
        current = "";
      } else if (ch === "\r") {
        // skip \r
        continue;
      } else if (ch === "\n") {
        row.push(current.trim());
        if (row.length > 1 || row[0] !== "") {
          rows.push(row);
        }
        row = [];
        current = "";
      } else {
        current += ch;
      }
    }
  }

  // Last field
  if (current || row.length > 0) {
    row.push(current.trim());
    if (row.length > 1 || row[0] !== "") {
      rows.push(row);
    }
  }

  return rows;
}

/**
 * Build a header-name to column-index map from the header row.
 */
export function buildHeaderMap(header: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (let i = 0; i < header.length; i++) {
    map[header[i].trim()] = i;
  }
  return map;
}

/**
 * Safely get a string value from a row by column index.
 */
export function getCell(row: string[], idx: number): string {
  return idx < row.length ? row[idx].trim() : "";
}

/**
 * Parse a numeric string, returning 0 if invalid.
 */
export function safeFloat(val: string | undefined | null): number {
  if (!val) return 0;
  const cleaned = val.replace(/,/g, "").trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

/**
 * Parse an integer string, returning 0 if invalid.
 */
export function safeInt(val: string | undefined | null): number {
  if (!val) return 0;
  const cleaned = val.replace(/,/g, "").trim();
  const n = parseInt(cleaned, 10);
  return isNaN(n) ? 0 : n;
}

/**
 * Apply a percentage ratio to a value.
 */
export function applyRatio(value: number, ratio: number): number {
  return (value * ratio) / 100;
}

/**
 * Parse a loose date string in various Japanese/ISO formats.
 * Returns a Date or null.
 */
export function parseDateLoose(val: string): Date | null {
  if (!val || !val.trim()) return null;
  const v = val.trim();
  // Try formats: YYYY/MM/DD HH:MM:SS, YYYY/MM/DD, YYYY-MM-DD
  const patterns = [
    /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+\d{1,2}:\d{2}(:\d{2})?$/,
    /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/,
  ];
  for (const p of patterns) {
    const m = v.match(p);
    if (m) {
      return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
    }
  }
  return null;
}

/**
 * Check if a date falls within the given year/month.
 */
export function isInMonth(
  dt: Date | null,
  year: number,
  month: number,
): boolean {
  if (!dt) return false;
  return dt.getFullYear() === year && dt.getMonth() + 1 === month;
}

/**
 * Detect year/month from a filename pattern like "2026年02月" or "202602".
 */
export function detectYearMonthFromFilename(
  filename: string,
): { year: number; month: number } | null {
  // Pattern: 2026年02月 or 2026年2月
  let m = filename.match(/(\d{4})年(\d{1,2})月/);
  if (m) {
    return { year: parseInt(m[1]), month: parseInt(m[2]) };
  }
  // Pattern: 202602
  m = filename.match(/(\d{4})(\d{2})/);
  if (m) {
    const y = parseInt(m[1]);
    const mo = parseInt(m[2]);
    if (y >= 2020 && y <= 2030 && mo >= 1 && mo <= 12) {
      return { year: y, month: mo };
    }
  }
  return null;
}
