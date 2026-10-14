// Shared by the UI and server; never promote a manager to admin.
export function canViewAllStores(role: string): boolean {
  return role === "admin" || role === "manager";
}
export function canManage(role: string): boolean { return role === "admin"; }

/**
 * 取込専用ロール（ingest）: 日次の自動取込（GitHub Actions）専用のサービスアカウント用。
 * 画面・設定・ユーザー管理・閲覧APIには一切入れず、下の許可リストのAPIだけを呼べる（最小権限）。
 * 許可リストは「完全一致のパス＋メソッド」。ここに無いものはすべて拒否する。
 */
export const INGEST_ROLE = "ingest";
const INGEST_ALLOWED: ReadonlyArray<{ method: string; path: string }> = [
  { method: "POST", path: "/api/upload/hacomono" },       // hacomono 会員・売上・商品別売上・Square
  { method: "POST", path: "/api/upload/enquete" },        // アンケート回答
  { method: "GET", path: "/api/upload/enquete" },         // 同・取込前の件数確認
  { method: "POST", path: "/api/upload/trial-sheet" },    // 体験シート
  { method: "POST", path: "/api/upload/fee-electricity" },// 決済手数料・電気料
  { method: "POST", path: "/api/upload/payroll" },        // 人件費（クラウド給与 支給控除一覧表・月1回）。ingest は上書き・氏名の強制変更不可（route 側で制御）
  { method: "GET", path: "/api/upload/payroll" },         // 同・対象年月が取込済みかの件数確認（読み取りのみ）
  { method: "GET", path: "/api/data-freshness" },         // 鮮度チェック（読み取りのみ）
];
export function isIngestAllowedApi(path: string, method: string): boolean {
  return INGEST_ALLOWED.some((a) => a.path === path && a.method === method.toUpperCase());
}
/** 取込を許す役割（admin と ingest）。許可リスト外のAPIは proxy.ts が ingest を拒否する */
export function canIngest(role: string): boolean { return role === "admin" || role === INGEST_ROLE; }
export function isAdminPage(path: string): boolean {
  return ["/upload", "/settings", "/promotion"].some(p => path === p || path.startsWith(p + "/"));
}
export function isRestrictedApi(path: string, method: string): boolean {
  if (!path.startsWith("/api/")) return false;
  // Expense entry is allowed; the route enforces each row's store scope.
  if (path === "/api/dashboard/expenses" && method === "PUT") return false;
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) return true;
  if (path.startsWith("/api/upload")) return true;
  // Dashboard selectors read these metadata endpoints; no settings UI is exposed.
  const metadata = ["/api/settings/stores", "/api/settings/store-display-names"];
  return path.startsWith("/api/settings/") && !metadata.includes(path);
}
