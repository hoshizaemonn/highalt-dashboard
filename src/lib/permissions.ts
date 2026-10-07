// Shared by the UI and server; never promote a manager to admin.
export function canViewAllStores(role: string): boolean {
  return role === "admin" || role === "manager";
}
export function canManage(role: string): boolean { return role === "admin"; }
export function isAdminPage(path: string): boolean {
  return ["/upload", "/settings", "/promotion"].some(p => path === p || path.startsWith(p + "/"));
}
export function isRestrictedApi(path: string, method: string): boolean {
  if (!path.startsWith("/api/")) return false;
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) return true;
  if (path.startsWith("/api/upload")) return true;
  // Dashboard selectors read these metadata endpoints; no settings UI is exposed.
  const metadata = ["/api/settings/stores", "/api/settings/store-display-names"];
  return path.startsWith("/api/settings/") && !metadata.includes(path);
}
