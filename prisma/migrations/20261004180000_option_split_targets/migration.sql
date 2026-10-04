-- オプション売上按分ルールに「按分先（複数可）」のJSON列を追加（nullable）。追加のみ。既存行・既存テーブルは変更しない。
-- AlterTable
ALTER TABLE "option_sales_split_rule" ADD COLUMN "targets" TEXT;
