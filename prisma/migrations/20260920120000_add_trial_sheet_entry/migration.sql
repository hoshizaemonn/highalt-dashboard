-- CreateTable
CREATE TABLE "trial_sheet_entry" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "store_name" TEXT NOT NULL,
    "entry_date" TEXT,
    "member_name" TEXT,
    "result_type" TEXT NOT NULL,
    "source_file" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trial_sheet_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trial_sheet_entry_year_month_store_name_idx" ON "trial_sheet_entry"("year", "month", "store_name");
