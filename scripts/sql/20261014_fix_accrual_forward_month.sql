-- 経費明細の「前払い」行の帰属年を直す（承認後に手で1回だけ実行する）
-- 原因: 旧ロジックは「内訳のN月 > 決済月 なら前年」と判定していたため、
--       6/30決済の「7月チラシ分」が 2025/7 に飛び、どの画面にも出なくなっていた。
-- 対象: 2026-10-14 時点の読み取り確認で特定した8行（新ロジックで再計算して差分が出たのはこの8行だけ）。
-- 条件に accrual_year = year - 1 を入れているので、2回実行しても2回目は0行。
BEGIN;
UPDATE expense_data
   SET accrual_year = accrual_year + 1
 WHERE id IN (301, 322, 338, 368, 442, 662, 790, 843)
   AND accrual_year = year - 1;
-- 期待: UPDATE 8
SELECT id, year, month, store_name, amount, accrual_year, accrual_month
  FROM expense_data WHERE id IN (301, 322, 338, 368, 442, 662, 790, 843) ORDER BY id;
COMMIT;
