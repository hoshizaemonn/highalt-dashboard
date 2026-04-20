const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const ALLOWED_EXTENSIONS = new Set([
  ".csv",
  ".xlsx",
  ".xls",
]);

const ALLOWED_MIME_TYPES = new Set([
  "text/csv",
  "text/plain",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream", // Some browsers send this for CSV
]);

/**
 * Validate an uploaded file for size and type.
 * Returns an error message string if invalid, or null if valid.
 */
export function validateUploadedFile(file: File): string | null {
  if (file.size > MAX_FILE_SIZE) {
    return `ファイルサイズが上限(10MB)を超えています: ${(file.size / 1024 / 1024).toFixed(1)}MB`;
  }

  const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] || "";
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return `許可されていないファイル形式です: ${ext || "(拡張子なし)"}。CSV または Excel ファイルのみアップロードできます`;
  }

  // MIME type check (lenient — browsers are inconsistent)
  if (file.type && !ALLOWED_MIME_TYPES.has(file.type)) {
    return `許可されていないファイル形式です: ${file.type}`;
  }

  return null;
}
