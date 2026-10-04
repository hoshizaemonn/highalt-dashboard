-- オプション売上按分ルールに「商品名（摘要に含まれる名前）」の列を追加（nullable・既存行なし）。
-- 追加のみ。既存テーブルは変更しない。
-- AlterTable
ALTER TABLE "option_sales_split_rule" ADD COLUMN "match_name" TEXT;
