// 実行: node --experimental-strip-types src/lib/permissions.test.ts
// @ts-expect-error node --experimental-strip-types で直接実行するため .ts 拡張子が必要
import { isIngestAllowedApi, canIngest, canManage, canViewAllStores } from "./permissions.ts";
import assert from "node:assert/strict";

// 取込専用ロール(ingest)が呼べるのは、許可リストのパス×メソッドだけ
const ok: [string, string][] = [
  ["POST", "/api/upload/hacomono"], ["POST", "/api/upload/enquete"], ["GET", "/api/upload/enquete"],
  ["POST", "/api/upload/trial-sheet"], ["POST", "/api/upload/fee-electricity"], ["GET", "/api/data-freshness"],
  ["POST", "/api/upload/payroll"], ["GET", "/api/upload/payroll"],
];
for (const [m, p] of ok) assert.equal(isIngestAllowedApi(p, m), true, `${m} ${p}`);
const ng: [string, string][] = [
  ["GET", "/api/dashboard"], ["GET", "/api/users"], ["POST", "/api/users"], ["PUT", "/api/users"], ["DELETE", "/api/users"],
  ["POST", "/api/settings/option-sales-split"], ["GET", "/api/settings/option-sales-split"],
  ["DELETE", "/api/upload/payroll"], ["PUT", "/api/upload/payroll"], ["POST", "/api/upload/payroll/x"], ["GET", "/api/download/payroll-excel"],
  ["GET", "/api/dashboard/payroll-detail"], ["POST", "/api/settings/manual-payroll"],
  ["POST", "/api/upload/amazon"], ["POST", "/api/upload/budget"], ["GET", "/api/upload-logs"], ["GET", "/settings"], ["GET", "/dashboard"],
  ["DELETE", "/api/upload/hacomono"], ["GET", "/api/upload/hacomono"], ["POST", "/api/data-freshness"],
  ["POST", "/api/upload/hacomono/../users"], ["POST", "/api/upload/hacomono/x"],
];
for (const [m, p] of ng) assert.equal(isIngestAllowedApi(p, m), false, `${m} ${p}`);

// 役割: ingest は取込だけ。管理・全店舗閲覧はできない。manager は取込できない（10/7の権限分離を維持）
assert.equal(canIngest("admin"), true);
assert.equal(canIngest("ingest"), true);
assert.equal(canIngest("manager"), false);
assert.equal(canIngest("store_manager"), false);
assert.equal(canManage("ingest"), false);
assert.equal(canViewAllStores("ingest"), false);
console.log("PERMISSIONS TESTS PASSED");
