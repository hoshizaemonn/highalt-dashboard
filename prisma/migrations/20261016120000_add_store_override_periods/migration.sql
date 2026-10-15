-- 従業員→店舗マッピングを「期間」単位で持つテーブル。新規テーブルの追加のみ。
-- 既存テーブル・既存データには一切触れない（DROP / 既存テーブルのALTER / UPDATE / DELETE なし）。
-- 既存の store_overrides はそのまま「開始月（null＝最初から）〜継続中」の1期間として読む。
-- 本番適用は承認後（Supabase SQL Editor で本ファイルだけを実行、または `npx prisma db execute --file <本ファイル>`）。

-- CreateTable
CREATE TABLE IF NOT EXISTS "store_override_periods" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "employee_name" TEXT NOT NULL DEFAULT '',
    "start_year" INTEGER,
    "start_month" INTEGER,
    "end_year" INTEGER,
    "end_month" INTEGER,
    "store_name" TEXT NOT NULL,
    "ratio" INTEGER NOT NULL,
    "base_store" TEXT,
    "updated_by" TEXT NOT NULL DEFAULT '',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_override_periods_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "store_override_periods_start_check" CHECK (("start_year" IS NULL) = ("start_month" IS NULL)),
    CONSTRAINT "store_override_periods_end_check" CHECK (("end_year" IS NULL) = ("end_month" IS NULL)),
    CONSTRAINT "store_override_periods_month_check" CHECK (
        ("start_month" IS NULL OR "start_month" BETWEEN 1 AND 12)
        AND ("end_month" IS NULL OR "end_month" BETWEEN 1 AND 12)
    ),
    CONSTRAINT "store_override_periods_ratio_check" CHECK ("ratio" BETWEEN 1 AND 100)
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "store_override_periods_employee_id_idx"
    ON "store_override_periods"("employee_id");

-- Supabase の公開API（anon / authenticated）から読めないようにする（新規テーブルのみ対象）。
-- テーブル所有者（業績ダッシュボードの接続）は影響を受けない。
ALTER TABLE "store_override_periods" ENABLE ROW LEVEL SECURITY;
