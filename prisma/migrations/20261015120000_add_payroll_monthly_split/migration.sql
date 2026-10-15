-- 人件費の「月別の店舗按分調整」を保存するテーブル。新規テーブルの追加のみ。
-- 既存テーブル・既存データには一切触れない（DROP / 既存テーブルのALTER / UPDATE / DELETE なし）。
-- 本番適用は承認後（Supabase SQL Editor で本ファイルだけを実行、または `npx prisma db execute --file <本ファイル>`）。

-- CreateTable
CREATE TABLE IF NOT EXISTS "payroll_monthly_split" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "employee_id" TEXT NOT NULL,
    "store_name" TEXT NOT NULL,
    "ratio" INTEGER NOT NULL,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_monthly_split_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payroll_monthly_split_month_check" CHECK ("month" BETWEEN 1 AND 12),
    CONSTRAINT "payroll_monthly_split_ratio_check" CHECK ("ratio" BETWEEN 1 AND 100)
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "payroll_monthly_split_year_month_employee_id_store_name_key"
    ON "payroll_monthly_split"("year", "month", "employee_id", "store_name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "payroll_monthly_split_employee_id_idx"
    ON "payroll_monthly_split"("employee_id");

-- Supabase の公開API（anon / authenticated）から読めないようにする（新規テーブルのみ対象）。
-- テーブル所有者（業績ダッシュボードの接続）は影響を受けない。
ALTER TABLE "payroll_monthly_split" ENABLE ROW LEVEL SECURITY;
