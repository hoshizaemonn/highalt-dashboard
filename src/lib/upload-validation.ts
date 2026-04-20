const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_EXTENSIONS = [".csv", ".xls", ".xlsx"];

export function validateUploadFile(file: File): string | null {
  if (file.size > MAX_FILE_SIZE) {
    return `ファイルサイズが大きすぎます（最大10MB）。現在: ${(file.size / 1024 / 1024).toFixed(1)}MB`;
  }
  const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] || "";
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return `対応していないファイル形式です。CSV、XLS、XLSXのみアップロードできます。`;
  }
  return null; // valid
}
