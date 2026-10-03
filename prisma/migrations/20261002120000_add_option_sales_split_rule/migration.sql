-- CreateTable
CREATE TABLE "option_sales_split_rule" (
    "id" SERIAL NOT NULL,
    "product_code" TEXT NOT NULL,
    "target_store" TEXT NOT NULL,
    "ratio_percent" INTEGER NOT NULL DEFAULT 50,
    "start_year" INTEGER,
    "start_month" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_by_name" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "option_sales_split_rule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "option_sales_split_rule_product_code_key" ON "option_sales_split_rule"("product_code");
