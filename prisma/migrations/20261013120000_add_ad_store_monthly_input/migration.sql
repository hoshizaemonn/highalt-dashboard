-- 広告ダッシュボードの店舗×月 入力（その他広告費・目標の体験CPA）。新規テーブルの追加のみ。
-- 既存テーブル・既存データには一切触れない（DROP / 既存テーブルのALTER / UPDATE / DELETE なし）。
-- 本番適用は承認後（Supabase SQL Editor で本ファイルだけを実行、または `npx prisma db execute --file <本ファイル>`）。

-- CreateTable
CREATE TABLE IF NOT EXISTS "ad_store_monthly_input" (
    "id" SERIAL NOT NULL,
    "store_name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "other_ad_cost" INTEGER,
    "target_trial_cpa" INTEGER,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_store_monthly_input_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ad_store_monthly_input_month_check" CHECK ("month" BETWEEN 1 AND 12),
    CONSTRAINT "ad_store_monthly_input_amount_check" CHECK (
        ("other_ad_cost" IS NULL OR "other_ad_cost" BETWEEN 0 AND 100000000) AND
        ("target_trial_cpa" IS NULL OR "target_trial_cpa" BETWEEN 1 AND 10000000))
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ad_store_monthly_input_store_name_year_month_key"
    ON "ad_store_monthly_input"("store_name", "year", "month");

-- Supabase の公開API（anon / authenticated）から読めないようにする。
-- テーブル所有者（業績ダッシュボードの接続）は影響を受けない。広告アプリ用ロールの許可は別SQL（ポリシー）で与える。
ALTER TABLE "ad_store_monthly_input" ENABLE ROW LEVEL SECURITY;
