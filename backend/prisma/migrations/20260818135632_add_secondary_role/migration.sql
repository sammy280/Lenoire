/*
  Warnings:

  - The values [REQUISITION,RETURN_REQUEST,TRANSPORT,SALARY,DAILY_REPORT,USER_UPDATE,PAYROLL] on the enum `NotificationType` will be removed. If these variants are still used in the database, this will fail.
  - The values [COMPLETED,EXPIRED] on the enum `OrderStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "NotificationType_new" AS ENUM ('ORDER_UPDATE', 'KITCHEN_UPDATE', 'BAR_UPDATE', 'BILL_UPDATE', 'PAYMENT_UPDATE', 'STOCK_ALERT', 'PUNISHMENT_REQUEST', 'EMPLOYEE_FIRED', 'SUPPLIER_PURCHASE', 'DELETE_REQUEST', 'SYSTEM', 'ONLINE_ORDER', 'LOYALTY');
ALTER TABLE "Notification" ALTER COLUMN "type" TYPE "NotificationType_new" USING ("type"::text::"NotificationType_new");
ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
ALTER TYPE "NotificationType_new" RENAME TO "NotificationType";
DROP TYPE "NotificationType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "OrderStatus_new" AS ENUM ('PENDING', 'PREPARING', 'READY', 'SERVED', 'CANCELLED');
ALTER TABLE "BarOrder" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "KitchenOrder" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Order" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Order" ALTER COLUMN "status" TYPE "OrderStatus_new" USING ("status"::text::"OrderStatus_new");
ALTER TABLE "KitchenOrder" ALTER COLUMN "status" TYPE "OrderStatus_new" USING ("status"::text::"OrderStatus_new");
ALTER TABLE "BarOrder" ALTER COLUMN "status" TYPE "OrderStatus_new" USING ("status"::text::"OrderStatus_new");
ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";
ALTER TYPE "OrderStatus_new" RENAME TO "OrderStatus";
DROP TYPE "OrderStatus_old";
ALTER TABLE "BarOrder" ALTER COLUMN "status" SET DEFAULT 'PENDING';
ALTER TABLE "KitchenOrder" ALTER COLUMN "status" SET DEFAULT 'PENDING';
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "secondaryRole" "Role";
