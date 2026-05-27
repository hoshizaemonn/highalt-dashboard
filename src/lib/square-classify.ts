// Square アイテム別売上の商品名/カテゴリから売上分類を判定する。
// 運用ルール: クライアント側で商品名に下記キーワードを含めて登録する。
//   - "パーソナル" → パーソナル
//   - "物販" / 物販系商品名 → 物販
//   - "サービス"  → サービス
//   - 上記以外    → その他
//
// 取り込み時に classification として保存し、ダッシュボード集計で
// 「パーソナル売上」「物販売上」の優先ソースとして利用する。

export type SquareClassification = "パーソナル" | "物販" | "サービス" | "その他";

const PERSONAL_KEYWORDS = ["パーソナル", "ＰＴ", "personal"];
const MERCH_KEYWORDS = [
  "物販",
  "サプリ",
  "ドリンク",
  "ウェア",
  "タオル",
  "プロテイン",
  "グッズ",
  "BCAA",
];
const SERVICE_KEYWORDS = ["サービス", "オプション", "レンタル", "施術", "ケア"];

export function classifySquareItem(
  itemName: string,
  categoryRaw?: string | null,
): SquareClassification {
  const haystack = `${itemName || ""} ${categoryRaw || ""}`;
  const lower = haystack.toLowerCase();
  if (PERSONAL_KEYWORDS.some((k) => haystack.includes(k) || lower.includes(k.toLowerCase()))) {
    return "パーソナル";
  }
  if (MERCH_KEYWORDS.some((k) => haystack.includes(k) || lower.includes(k.toLowerCase()))) {
    return "物販";
  }
  if (SERVICE_KEYWORDS.some((k) => haystack.includes(k) || lower.includes(k.toLowerCase()))) {
    return "サービス";
  }
  return "その他";
}
