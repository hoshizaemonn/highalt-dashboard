-- Amazon 注文の行キー修正（同じ注文に同じ商品が複数行あると、旧キー（注文番号+商品名）で1行に潰れていた）。
-- 追加と索引の付け替えのみ。既存行のデータは変更しない（既存行は tracking_no='' / line_seq=0 になる）。
-- 既存データ（474行）で (order_id, asin) の重複・NULL注文番号・空ASINが無いことを読み取りで確認済み＝新しい一意索引は作成できる。

-- AlterTable
ALTER TABLE "amazon_orders" ADD COLUMN "tracking_no" TEXT NOT NULL DEFAULT '',
ADD COLUMN "line_seq" INTEGER NOT NULL DEFAULT 0;

-- DropIndex
DROP INDEX "amazon_orders_order_id_product_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "amazon_orders_order_id_asin_tracking_no_line_seq_key" ON "amazon_orders"("order_id", "asin", "tracking_no", "line_seq");
