// ログイン後の画面最上部に出す「データ鮮度の警告」（管理者・マネージャー向け）。
// 鮮度チェック（/api/data-freshness と同じ判定）が赤＝古い／欠けている項目がある、
// または体験者数が画面間で一致していない、のときだけ警告を返す。
// 読み取りのみ。個人情報は含めない（項目名・店舗名・件数のみ）。5分キャッシュ。

import { loadDataFreshness } from "@/lib/data-freshness-loader";
import { summarize } from "@/lib/data-freshness";
import { currentAndPreviousMonthJst, loadTrialConsistency } from "@/lib/trial-consistency";
import { memoCache } from "@/lib/memo-cache";
import { logError } from "@/lib/log";

export interface FreshnessAlert {
  problemCount: number;
  /** 表示用の短い説明（最大5件） */
  lines: string[];
}

const TTL_MS = 5 * 60 * 1000;

export async function loadFreshnessAlert(): Promise<FreshnessAlert | null> {
  try {
    return await memoCache("freshness-alert", TTL_MS, async () => {
      const { items } = await loadDataFreshness();
      const s = summarize(items);
      const trial = await loadTrialConsistency(currentAndPreviousMonthJst());
      const lines = [
        ...s.problems.map(
          (p) => `${p.label}${p.store ? `（${p.store}）` : ""}: ${p.status === "missing" ? "記録なし" : `最終 ${p.latest}`}`,
        ),
        ...trial.flatMap((t) => t.problems.map((p) => `体験者数の不一致 ${p}`)),
      ];
      if (lines.length === 0) return null;
      return { problemCount: lines.length, lines: lines.slice(0, 5) };
    });
  } catch (error) {
    // 警告の取得に失敗しても画面は出す（警告が出ないだけ）
    logError("FreshnessAlert error:", error);
    return null;
  }
}
