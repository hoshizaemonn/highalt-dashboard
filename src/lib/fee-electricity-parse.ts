// 決済手数料（PAY.JP / fincode）・電気料（シンエナジー）の一括取込パーサ。
//
// クライアント（ハイアルチ）が毎月受領する以下3種を店舗別・月次の経費に変換する:
//   - PAY.JP 決済手数料（店舗別サマリCSV）      → 支払手数料
//   - fincode 決済手数料（取引明細CSV・要合算） → 支払手数料
//   - シンエナジー 電気料金明細（Excel）        → 電気料
//
// 支払手数料は「PAY.JP + fincode の合算」で1店舗1値（松尾さん/星﨑さん確定 2026-07）。
// 保存先は本部一括経費と同じ manual_expense_entry（店舗別・月次）。

import { STORES } from "@/lib/constants";

export interface StoreAmount {
  store: string;
  amount: number; // 円
}

/**
 * 店舗の別名義 → 店舗名 の対応表。
 * 請求書は店舗名そのものではなく、契約名義・カナ表記で登録されていることがある。
 *  - シンエナジー電気: 春日は「ハイアルチカスガスタジオ」＝カナ表記（松尾さん確認 2026-07）
 *  - シンエナジー電気: 船橋は「相互住宅（プライマル船橋）」＝オーナー法人名義
 * カナ表記は他店舗にも及ぶ可能性があるため、全店舗ぶん登録しておく。
 */
const STORE_ALIASES: Array<{ alias: string; store: string }> = [
  // カナ表記（長い方から先に判定されるよう、より具体的なものを上に置く）
  { alias: "ヒガシニホンバシ", store: "東日本橋" },
  { alias: "ソシガヤオオクラ", store: "祖師ヶ谷大蔵" },
  { alias: "ソシガヤ", store: "祖師ヶ谷大蔵" },
  { alias: "シモキタザワ", store: "下北沢" },
  { alias: "ナカメグロ", store: "中目黒" },
  { alias: "カスガ", store: "春日" },
  { alias: "フナバシ", store: "船橋" },
  { alias: "スガモ", store: "巣鴨" },
  // 契約名義
  { alias: "相互住宅", store: "船橋" },
  { alias: "プライマル船橋", store: "船橋" },
  { alias: "船橋市", store: "船橋" },
];

/** 店舗名/住所などの文字列を STORES のいずれかに解決する（該当なしは null）。 */
export function resolveStore(raw: unknown): string | null {
  let s = String(raw ?? "").replace(/\s/g, "");
  if (!s) return null;
  // 「春日部」(埼玉)を「春日」(文京区)と誤判定しないよう、判定前に除去する（カナ表記も同様）
  s = s.replace(/春日部/g, "").replace(/カスガベ/g, "");
  // 1. 店舗名（漢字）で判定
  for (const st of STORES) {
    if (s.includes(st)) return st;
  }
  // 2. 別名義（カナ表記・契約名義）で判定
  for (const { alias, store } of STORE_ALIASES) {
    if (s.includes(alias)) return store;
  }
  return null;
}

/** "1,234" / "¥1,234" / "(516)" / 数値 などを数値化。 */
function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  let t = String(v).trim();
  if (!t) return 0;
  const neg = /^\(.*\)$/.test(t);
  t = t.replace(/[¥,()"]/g, "").replace(/\s/g, "");
  const n = parseFloat(t);
  if (isNaN(n)) return 0;
  return neg ? -n : n;
}

/** ヘッダ行から列indexを探す（まず完全一致、無ければ部分一致）。 */
function findCol(header: unknown[], names: string[]): number {
  const norm = (h: unknown) => String(h ?? "").replace(/\s/g, "");
  // 完全一致優先
  for (const nm of names) {
    const i = header.findIndex((h) => norm(h) === nm.replace(/\s/g, ""));
    if (i >= 0) return i;
  }
  // 部分一致
  for (const nm of names) {
    const key = nm.replace(/\s/g, "");
    const i = header.findIndex((h) => norm(h).includes(key));
    if (i >= 0) return i;
  }
  return -1;
}

function aggregate(pairs: Array<{ store: string | null; amount: number }>): StoreAmount[] {
  const map = new Map<string, number>();
  for (const p of pairs) {
    if (!p.store) continue;
    map.set(p.store, (map.get(p.store) ?? 0) + p.amount);
  }
  return [...map.entries()]
    .map(([store, amount]) => ({ store, amount: Math.round(amount) }))
    .filter((r) => r.amount !== 0);
}

/**
 * PAY.JP 決済手数料 CSV（店舗別サマリ）。
 * 列: 店舗名 / … / PAY.JP決済手数料 / 入金額。店舗別に手数料を返す。
 */
export function parsePayjpFee(rows: string[][]): StoreAmount[] {
  if (rows.length < 2) return [];
  const header = rows[0];
  const storeCol = findCol(header, ["店舗名", "店舗"]);
  const feeCol = findCol(header, ["PAY.JP決済手数料", "決済手数料"]);
  if (storeCol < 0 || feeCol < 0) {
    throw new Error(
      "PAY.JP CSVの列（店舗名 / PAY.JP決済手数料）が見つかりません。正しいファイルか確認してください。",
    );
  }
  return aggregate(
    rows.slice(1).map((r) => ({
      store: resolveStore(r[storeCol]),
      amount: num(r[feeCol]),
    })),
  );
}

/**
 * fincode 決済手数料 CSV（取引明細）。
 * 取引単位の「決済手数料（税込）（参考値）」を店舗別に合算して返す。
 * ヘッダに「店舗」と「メンバー所属店舗」が両方あるため、完全一致で「店舗」列を取る。
 */
export function parseFincodeFee(rows: string[][]): StoreAmount[] {
  if (rows.length < 2) return [];
  const header = rows[0];
  const storeCol = findCol(header, ["店舗"]); // 完全一致優先（"店舗ID"等を避ける）
  const feeCol = findCol(header, [
    "決済手数料（税込）（参考値）",
    "決済手数料(税込)(参考値)",
    "決済手数料（税込）",
  ]);
  if (storeCol < 0 || feeCol < 0) {
    throw new Error(
      "fincode CSVの列（店舗 / 決済手数料（税込）（参考値））が見つかりません。正しいファイルか確認してください。",
    );
  }
  return aggregate(
    rows.slice(1).map((r) => ({
      store: resolveStore(r[storeCol]),
      amount: num(r[feeCol]),
    })),
  );
}

/**
 * シンエナジー 電気料金明細（Excel を2次元配列にしたもの）。
 * 「№」で始まるヘッダ行を探し、「電気のご使用場所表示名」「…住所」から店舗を判定、
 * 「請求金額合計（円）」を店舗別に合算して返す。
 */
export function parseSinenergyElectricity(rows: unknown[][]): StoreAmount[] {
  const norm = (v: unknown) => String(v ?? "").replace(/\s/g, "");
  const headerIdx = rows.findIndex((r) => r.some((c) => norm(c) === "№" || norm(c) === "No" || norm(c) === "NO"));
  if (headerIdx < 0) {
    throw new Error("電気料金明細（シンエナジー）のヘッダ行（№）が見つかりません。正しいファイルか確認してください。");
  }
  const header = rows[headerIdx];
  const dispCol = findCol(header, ["電気のご使用場所表示名", "使用場所表示名", "表示名"]);
  const addrCol = findCol(header, ["電気のご使用場所住所", "使用場所住所", "住所"]);
  const amtCol = findCol(header, ["請求金額合計（円）", "請求金額合計", "請求金額"]);
  if (amtCol < 0 || (dispCol < 0 && addrCol < 0)) {
    throw new Error("電気料金明細の列（表示名/住所・請求金額合計）が見つかりません。");
  }
  const pairs: Array<{ store: string | null; amount: number }> = [];
  // どの店舗にも解決できなかった明細（原因調査用にエラーへ載せる）
  const unresolved: string[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r[0] == null || String(r[0]).trim() === "") continue;
    const disp = dispCol >= 0 ? String(r[dispCol] ?? "") : "";
    const addr = addrCol >= 0 ? String(r[addrCol] ?? "") : "";
    const amount = num(r[amtCol]);
    const store = resolveStore(`${disp} ${addr}`);
    if (!store && amount !== 0) {
      unresolved.push(`「${disp.trim()}」(${addr.trim()})`);
    }
    pairs.push({ store, amount });
  }
  const result = aggregate(pairs);
  // 1件も店舗判定できなかった場合は、判定できなかった名義を提示する。
  // （店舗名が契約名義で入っていると判定できないため。例: 船橋=「相互住宅（プライマル船橋）」）
  if (result.length === 0 && unresolved.length > 0) {
    throw new Error(
      `電気料金明細から店舗を判定できませんでした。以下の名義が店舗名と一致しません: ${unresolved
        .slice(0, 5)
        .join(" / ")}。契約名義で請求されている場合は対応表への追加が必要です。`,
    );
  }
  return result;
}
