-- AlterTable
ALTER TABLE "BarOrder" ADD COLUMN     "currentBatch" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "KitchenOrder" ADD COLUMN     "currentBatch" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "batchNumber" INTEGER NOT NULL DEFAULT 1;
