/* eslint-disable @typescript-eslint/no-explicit-any -- 単体テスト（ExcelJS・合成データの型を緩く扱う） */
// 実行: node --experimental-strip-types src/lib/sinenergy-invoice.test.ts
// 合成データ（実物と同じ構造）で検証する。手元に実物の請求明細Excelがあれば、追加で実物4ファイルも検証する。
// @ts-expect-error node --experimental-strip-types で直接実行するため .ts 拡張子が必要
import { parseSinenergyInvoice, planStoreImport, isExtremeChange, invoiceNote, SINENERGY_SUPPLY_POINTS } from "./sinenergy-invoice.ts";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const SP = Object.fromEntries(SINENERGY_SUPPLY_POINTS.map((p: any) => [p.placeNo, p]));
const line = (n: number, placeNo: string, amount: number) => [String(n), placeNo, "名義", "表示名", "住所", SP[placeNo].supplyPoint, "法人プランＣ", "", "", "", "2026/04/13", "〜", "2026/05/12", 1000, amount, 0];
const HEAD = ["№", "ご使用場所番号", "電気のご使用場所名義", "電気のご使用場所表示名 ", "電気のご使用場所住所", "供給地点特定番号", "料金メニュー", "契約数量", "単位", "力率", "使用期間", "", "", "使用\n電力量\n（kWh）", "請求\n金額\n合計（円）", "（うち消費税\n相当額）（円）"];
function sheet(opts: { no: string; usage: string; debit: string; lines: any[][]; total?: number }) {
  const sum = opts.lines.reduce((s, r) => s + Number(r[14]), 0);
  return [
    ["お客様番号：2186079", "", "", "", `請求書番号：${opts.no}`],
    ["Ｈｉｇｈ　Ａｌｔｉｔｕｄｅ　Ｍａｎａｇｅｍｅｎｔ", "", "御中", "", "管理番号：x"],
    ["", "", "", "", "作成年月日：2026年06月15日"],
    [`◆電気料金明細表（${opts.usage} ${opts.debit} 口座引落し分)`],
    [],
    HEAD,
    [], [], [], [],
    ...opts.lines,
    ["", "", "", "", "", "", "", "", "", "", "合 計", "", "", 0, opts.total ?? sum, 0],
    ["※料金その他の計算における単価は内税といたします。"],
  ];
}
const L123 = (a: number[]) => [line(1, "J0259642", a[0]), line(2, "J0245238", a[1]), line(3, "J0245239", a[2]), line(4, "J0259643", a[3]), line(5, "J0245237", a[4])];

// 1. 正常（05月分・…123…）: 月＝引落月（6月）、店舗合算、合計一致
{
  const p = parseSinenergyInvoice(sheet({ no: "218607900123202605", usage: "2026年05月分", debit: "2026年06月23日", lines: L123([45285, 68378, 28814, 111217, 192268]) }));
  assert.deepEqual(p.errors, []);
  assert.equal(p.invoiceNo, "218607900123202605");
  assert.deepEqual([p.usageYear, p.usageMonth, p.bookingYear, p.bookingMonth], [2026, 5, 2026, 6]);
  const m = Object.fromEntries(p.byStore.map((x: any) => [x.store, x.amount]));
  assert.deepEqual(m, { 祖師ヶ谷大蔵: 156502, 船橋: 260646, 巣鴨: 28814 });
  assert.equal(p.linesTotal, 445962);
}
// 2. 春日の請求書（…105…・08月分→9月計上）
{
  const p = parseSinenergyInvoice(sheet({ no: "218607900105202608", usage: "2026年08月分", debit: "2026年09月05日", lines: [line(1, "J0245248", 66261)] }));
  assert.deepEqual(p.errors, []);
  assert.deepEqual([p.bookingYear, p.bookingMonth], [2026, 9]);
  assert.deepEqual(p.byStore, [{ store: "春日", amount: 66261 }]);
}
// 3. 年またぎ（12月分→翌年1月計上）
{
  const p = parseSinenergyInvoice(sheet({ no: "218607900105202612", usage: "2026年12月分", debit: "2027年01月05日", lines: [line(1, "J0245248", 50000)] }));
  assert.deepEqual(p.errors, []);
  assert.deepEqual([p.bookingYear, p.bookingMonth], [2027, 1]);
}
// 4. 未登録の供給地点が1行でもあれば取り込まない（黙って捨てない）
{
  const rows = sheet({ no: "218607900123202605", usage: "2026年05月分", debit: "2026年06月23日", lines: L123([45285, 68378, 28814, 111217, 192268]) });
  rows[10 + 2][5] = "0300111999999999999999"; rows[10 + 2][1] = "J9999999"; // №3 の番号を未登録に
  const p = parseSinenergyInvoice(rows);
  assert.ok(p.errors.some((e: string) => e.includes("対応表にない")), p.errors.join("|"));
}
// 5. 合計行と明細の合計が違えば取り込まない
{
  const p = parseSinenergyInvoice(sheet({ no: "218607900123202605", usage: "2026年05月分", debit: "2026年06月23日", lines: L123([45285, 68378, 28814, 111217, 192268]), total: 445000 }));
  assert.ok(p.errors.some((e: string) => e.includes("合計行")));
}
// 6. 月判定の失敗（タイトル不正／引落月が翌月でない／請求書番号と不一致）
{
  const bad1 = parseSinenergyInvoice(sheet({ no: "218607900123202605", usage: "あいうえお", debit: "", lines: L123([1, 2, 3, 4, 5]) }));
  assert.ok(bad1.errors.some((e: string) => e.includes("月を判定できません")));
  const bad2 = parseSinenergyInvoice(sheet({ no: "218607900123202605", usage: "2026年05月分", debit: "2026年08月23日", lines: L123([1, 2, 3, 4, 5]) }));
  assert.ok(bad2.errors.some((e: string) => e.includes("月の判定が一致しません")));
  const bad3 = parseSinenergyInvoice(sheet({ no: "218607900123202609", usage: "2026年05月分", debit: "2026年06月23日", lines: L123([1, 2, 3, 4, 5]) }));
  assert.ok(bad3.errors.some((e: string) => e.includes("請求書番号の末尾")));
}
// 7. 0件・ヘッダー無し
{
  const p = parseSinenergyInvoice(sheet({ no: "218607900123202605", usage: "2026年05月分", debit: "2026年06月23日", lines: [] }));
  assert.ok(p.errors.some((e: string) => e.includes("0件")));
  const q = parseSinenergyInvoice([["関係ない表"], ["a", "b"]]);
  assert.ok(q.errors.length >= 2);
}
// 8. 全角数字の請求書番号・半角/全角の表記ゆれ
{
  const p = parseSinenergyInvoice(sheet({ no: "２１８６０７９００１０５２０２６０８", usage: "２０２６年０８月分", debit: "２０２６年０９月０５日", lines: [line(1, "J0245248", 66261)] }));
  assert.deepEqual(p.errors, []);
}
// 9. 取込計画: 上書き／スキップ／保留／新規
{
  const NO = "218607900123202605";
  const mk = (existing: any[], prev: number | null, amount = 28814) => planStoreImport({ store: "巣鴨", amount, invoiceNo: NO, existing, previousAmount: prev });
  assert.equal(mk([], 21030).action, "create");
  assert.equal(mk([{ amount: 28814, note: invoiceNote(NO) }], 21030).action, "update");            // 同じ請求書番号 → 上書き
  const sk = mk([{ amount: 28814, note: "シンエナジー 自動取込（請求明細.xlsx）" }], 21030);          // 過去の手動取込 → スキップ
  assert.equal(sk.action, "skip-existing"); assert.ok(sk.reason!.includes("一致"));
  const sk2 = mk([{ amount: 21030, note: null }], 21030);                                          // 手入力・金額が違う → スキップして要確認
  assert.equal(sk2.action, "skip-existing"); assert.ok(sk2.reason!.includes("要確認"));
  assert.equal(mk([], 5000, 28814).action, "held");                                               // 3倍超 → 保留
  assert.equal(mk([], 100000, 28814).action, "held");                                             // 1/3未満 → 保留
  assert.equal(mk([], null).action, "create");                                                    // 前月なしは判定しない
  assert.equal(isExtremeChange(30000, 10000), false);                                             // ちょうど3倍は保留しない
  assert.equal(isExtremeChange(30001, 10000), true);
}

// 10. 実物4ファイル（手元にある場合のみ）
const DL = "/Users/hoshizaki/Downloads";
const files = ["請求明細.xlsx", "請求明細 (1).xlsx", "請求明細 (2).xlsx", "請求明細 (3).xlsx"];
if (files.every((f) => existsSync(`${DL}/${f}`))) {
  const ExcelJS = createRequire(import.meta.url.replace("src/lib/sinenergy-invoice.test.ts", "package.json"))("exceljs");
  const cellText = (v: any) => (v == null ? "" : typeof v === "object" ? (Array.isArray(v.richText) ? v.richText.map((t: any) => t.text ?? "").join("") : "text" in v ? String(v.text ?? "") : "result" in v ? String(v.result ?? "") : "") : v);
  const expect: Record<string, { book: [number, number]; stores: Record<string, number> }> = {
    "請求明細.xlsx": { book: [2026, 5], stores: { 祖師ヶ谷大蔵: 121211, 船橋: 200183, 巣鴨: 21030 } },
    "請求明細 (1).xlsx": { book: [2026, 6], stores: { 祖師ヶ谷大蔵: 156502, 船橋: 260646, 巣鴨: 28814 } },
    "請求明細 (2).xlsx": { book: [2026, 9], stores: { 祖師ヶ谷大蔵: 181674, 船橋: 257817, 巣鴨: 53391 } },
    "請求明細 (3).xlsx": { book: [2026, 9], stores: { 春日: 66261 } },
  };
  for (const f of files) {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(`${DL}/${f}`);
    const rows: any[][] = []; wb.worksheets[0].eachRow({ includeEmpty: true }, (r: any) => rows.push(Array.isArray(r.values) ? r.values.slice(1).map(cellText) : []));
    const p = parseSinenergyInvoice(rows);
    assert.deepEqual(p.errors, [], `${f}: ${p.errors.join("|")}`);
    assert.deepEqual([p.bookingYear, p.bookingMonth], expect[f].book, `${f} 計上月`);
    assert.deepEqual(Object.fromEntries(p.byStore.map((x: any) => [x.store, x.amount])), expect[f].stores, `${f} 店舗別`);
    console.log(`  実物OK: ${f} → ${p.bookingYear}年${p.bookingMonth}月計上 ${JSON.stringify(Object.fromEntries(p.byStore.map((x: any) => [x.store, x.amount])))}`);
  }
} else {
  console.log("  （実物4ファイルが無いため、実物テストはスキップ）");
}
console.log("SINENERGY-INVOICE TESTS PASSED");
