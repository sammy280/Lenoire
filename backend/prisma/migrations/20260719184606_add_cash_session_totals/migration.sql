-- AlterTable
ALTER TABLE "CashSession" ADD COLUMN     "billCount" INTEGER,
ADD COLUMN     "cashVariance" DECIMAL(10,2),
ADD COLUMN     "countedCash" DECIMAL(10,2),
ADD COLUMN     "expectedCash" DECIMAL(10,2),
ADD COLUMN     "openingCashAmount" DECIMAL(10,2),
ADD COLUMN     "totalCard" DECIMAL(10,2),
ADD COLUMN     "totalCash" DECIMAL(10,2),
ADD COLUMN     "totalCredit" DECIMAL(10,2),
ADD COLUMN     "totalMomo" DECIMAL(10,2),
ADD COLUMN     "totalRevenue" DECIMAL(10,2);
