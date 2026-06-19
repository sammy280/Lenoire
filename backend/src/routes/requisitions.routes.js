const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const prisma = require('../config/database');
const { createNotification } = require('../services/notification.service');
const { createAuditLog } = require('../middleware/audit');

router.use(authenticate);

// List requisitions (filtered by role)
router.get('/', async (req, res, next) => {
  try {
    const { status, category } = req.query;
    const where = {};
    if (status) where.status = status;
    if (category) where.category = category;
    // Kitchen/Bar staff only see their own; manager/admin/storekeeper see all
    if (['KITCHEN', 'BAR', 'WAITER'].includes(req.user.role)) {
      where.requestedById = req.user.id;
    }

    const requisitions = await prisma.requisition.findMany({
      where,
      include: {
        items: true,
        requestedBy: { select: { id: true, name: true, role: true } },
        reviewedBy: { select: { id: true, name: true } },
        purchaseOrder: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: requisitions });
  } catch (err) { next(err); }
});

// Create requisition (kitchen/bar/waiter)
router.post('/', async (req, res, next) => {
  try {
    const { title, category, items, notes, urgency } = req.body;
    const io = req.app.get('io');

    const req_ = await prisma.requisition.create({
      data: {
        title, category, notes, urgency: urgency || 'NORMAL',
        requestedById: req.user.id,
        items: { create: items.map(i => ({ name: i.name, quantity: parseFloat(i.quantity), unit: i.unit || 'unit', estimatedCost: i.estimatedCost ? parseFloat(i.estimatedCost) : undefined, notes: i.notes })) },
      },
      include: { items: true, requestedBy: { select: { id: true, name: true, role: true } } },
    });

    await createNotification({
      roles: ['MANAGER', 'ADMIN', 'STOREKEEPER'],
      type: 'REQUISITION',
      title: `📋 New Requisition — ${category}`,
      message: `${req.user.name} submitted a ${urgency || 'NORMAL'} priority requisition: "${title}"`,
      data: { requisitionId: req_.id },
      io,
    });

    await createAuditLog({ userId: req.user.id, role: req.user.role, action: 'CREATE_REQUISITION', description: `Created requisition: ${title}`, tableName: 'Requisition', recordId: req_.id });

    res.status(201).json({ success: true, data: req_ });
  } catch (err) { next(err); }
});

// Approve or reject (manager/admin)
router.patch('/:id/review', authorize('MANAGER', 'ADMIN'), async (req, res, next) => {
  try {
    const { status, reviewNote } = req.body; // APPROVED or REJECTED
    const io = req.app.get('io');

    const existing = await prisma.requisition.findUnique({ where: { id: req.params.id }, include: { requestedBy: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Not found' });

    const updated = await prisma.requisition.update({
      where: { id: req.params.id },
      data: { status, reviewedById: req.user.id, reviewNote, reviewedAt: new Date() },
    });

    await createNotification({
      userIds: [existing.requestedById],
      type: 'REQUISITION',
      title: status === 'APPROVED' ? '✅ Requisition Approved' : '❌ Requisition Rejected',
      message: status === 'APPROVED'
        ? `Your requisition "${existing.title}" has been approved by ${req.user.name}`
        : `Your requisition "${existing.title}" was rejected. ${reviewNote || ''}`,
      data: { requisitionId: existing.id },
      io,
    });

    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});

// Create purchase order for approved requisition (storekeeper/manager/admin)
router.post('/:id/purchase-order', authorize('MANAGER', 'ADMIN', 'STOREKEEPER'), async (req, res, next) => {
  try {
    const { supplier, totalCost, notes } = req.body;

    const requisition = await prisma.requisition.findUnique({
      where: { id: req.params.id },
      include: { requestedBy: true },
    });
    if (!requisition) return res.status(404).json({ success: false, message: 'Not found' });
    if (requisition.status !== 'APPROVED') return res.status(400).json({ success: false, message: 'Requisition must be approved first' });

    const po = await prisma.purchaseOrder.create({
      data: {
        requisitionId: req.params.id,
        supplier, totalCost: parseFloat(totalCost || 0), notes,
        createdById: req.user.id,
      },
    });

    await prisma.requisition.update({ where: { id: req.params.id }, data: { status: 'PURCHASED' } });

    res.status(201).json({ success: true, data: po });
  } catch (err) { next(err); }
});

// Mark delivered
router.patch('/:id/deliver', authorize('MANAGER', 'ADMIN', 'STOREKEEPER'), async (req, res, next) => {
  try {
    const updated = await prisma.requisition.update({
      where: { id: req.params.id },
      data: { status: 'DELIVERED' },
    });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});

// Reports: summary by category, status
router.get('/reports', authorize('MANAGER', 'ADMIN'), async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const where = {};
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const [all, byStatus, byCategory, totalPurchaseCost] = await Promise.all([
      prisma.requisition.count({ where }),
      prisma.requisition.groupBy({ by: ['status'], where, _count: true }),
      prisma.requisition.groupBy({ by: ['category'], where, _count: true }),
      prisma.purchaseOrder.aggregate({ _sum: { totalCost: true } }),
    ]);

    res.json({
      success: true,
      data: {
        total: all,
        byStatus: Object.fromEntries(byStatus.map(r => [r.status, r._count])),
        byCategory: Object.fromEntries(byCategory.map(r => [r.category, r._count])),
        totalPurchaseCost: parseFloat(totalPurchaseCost._sum.totalCost || 0),
      },
    });
  } catch (err) { next(err); }
});
// ─────────────────────────────────────────────────────────────────────────────
// ADD THIS ROUTE to your existing requisitions router
// Place it BEFORE the `module.exports = router;` line
// ─────────────────────────────────────────────────────────────────────────────

// Fulfill an approved requisition (storekeeper)
// POST /requisitions/:id/fulfill
// Body: {
//   supplierId: string,
//   notes?: string,
//   items: [
//     {
//       requisitionItemId: string,   // the RequisitionItem id
//       inventoryItemId: string,     // which InventoryItem to restock
//       quantityPurchased: number,   // actual qty bought (may differ from requested)
//       unitCost: number,            // cost per unit
//     }
//   ]
// }
router.post('/:id/fulfill', authorize('MANAGER', 'ADMIN', 'STOREKEEPER'), async (req, res, next) => {
  try {
    const { supplierId, notes, items } = req.body;
    const io = req.app.get('io');

    // ── 1. Validate requisition ──────────────────────────────────────────────
    const requisition = await prisma.requisition.findUnique({
      where: { id: req.params.id },
      include: {
        items: true,
        requestedBy: { select: { id: true, name: true } },
        purchaseOrder: true,
      },
    });

    if (!requisition) {
      return res.status(404).json({ success: false, message: 'Requisition not found' });
    }
    if (requisition.status !== 'APPROVED') {
      return res.status(400).json({ success: false, message: 'Only APPROVED requisitions can be fulfilled' });
    }
    if (requisition.purchaseOrder) {
      return res.status(400).json({ success: false, message: 'This requisition already has a purchase order' });
    }
    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one item is required' });
    }

    // ── 2. Validate all inventory items exist before starting transaction ────
    const inventoryItemIds = [...new Set(items.map(i => i.inventoryItemId))];
    const inventoryItems = await prisma.inventoryItem.findMany({
      where: { id: { in: inventoryItemIds } },
    });
    const inventoryMap = Object.fromEntries(inventoryItems.map(i => [i.id, i]));

    for (const item of items) {
      if (!inventoryMap[item.inventoryItemId]) {
        return res.status(400).json({
          success: false,
          message: `Inventory item not found: ${item.inventoryItemId}`,
        });
      }
      if (!item.quantityPurchased || parseFloat(item.quantityPurchased) <= 0) {
        return res.status(400).json({ success: false, message: 'All quantities must be greater than 0' });
      }
      if (!item.unitCost || parseFloat(item.unitCost) < 0) {
        return res.status(400).json({ success: false, message: 'Unit cost must be 0 or greater' });
      }
    }

    // ── 3. Calculate total cost ───────────────────────────────────────────────
    const totalCost = items.reduce((sum, item) => {
      return sum + parseFloat(item.quantityPurchased) * parseFloat(item.unitCost);
    }, 0);

    // ── 4. Atomic Prisma transaction ─────────────────────────────────────────
    const result = await prisma.$transaction(async (tx) => {

      // 4a. Create one Purchase record per item
      const purchases = await Promise.all(
        items.map(item => {
          const invItem = inventoryMap[item.inventoryItemId];
          return tx.purchase.create({
            data: {
              supplierId,
              product: invItem.name,
              quantity: parseFloat(item.quantityPurchased),
              unit: invItem.unit,
              unitCost: parseFloat(item.unitCost),
              totalCost: parseFloat(item.quantityPurchased) * parseFloat(item.unitCost),
              isPaid: false,
              purchasedBy: req.user.id,
              notes: notes || null,
            },
          });
        })
      );

      // 4b. Update inventory quantities + create StockMovement for each item
      await Promise.all(
        items.map(async (item) => {
          const invItem = inventoryMap[item.inventoryItemId];
          const prevQty = parseFloat(invItem.quantity);
          const addedQty = parseFloat(item.quantityPurchased);
          const newQty = prevQty + addedQty;

          // Update the inventory item quantity
          await tx.inventoryItem.update({
            where: { id: item.inventoryItemId },
            data: { quantity: newQty },
          });

          // Record the stock movement
          await tx.stockMovement.create({
            data: {
              inventoryItemId: item.inventoryItemId,
              type: 'IN',
              quantity: addedQty,
              previousQty: prevQty,
              newQty: newQty,
              reason: `Requisition fulfilled: ${requisition.title}`,
              reference: requisition.id,
              userId: req.user.id,
            },
          });
        })
      );

      // 4c. Create the PurchaseOrder record
      const purchaseOrder = await tx.purchaseOrder.create({
        data: {
          requisitionId: requisition.id,
          supplier: supplierId, // stores supplierId string — matches your schema field `supplier: String?`
          totalCost,
          status: 'RECEIVED',
          notes: notes || null,
          createdById: req.user.id,
        },
      });

      // 4d. Mark requisition as PURCHASED
      const updatedRequisition = await tx.requisition.update({
        where: { id: requisition.id },
        data: { status: 'PURCHASED' },
        include: {
          items: true,
          requestedBy: { select: { id: true, name: true, role: true } },
          purchaseOrder: true,
        },
      });

      return { purchases, purchaseOrder, updatedRequisition };
    });

    // ── 5. Notifications ──────────────────────────────────────────────────────
    await createNotification({
      userIds: [requisition.requestedById],
      type: 'REQUISITION',
      title: '✅ Requisition Fulfilled',
      message: `Your requisition "${requisition.title}" has been purchased and stock updated by ${req.user.name}.`,
      data: { requisitionId: requisition.id },
      io,
    });

    await createNotification({
      roles: ['MANAGER', 'ADMIN'],
      type: 'SUPPLIER_PURCHASE',
      title: '🛒 Stock Purchased',
      message: `${req.user.name} fulfilled requisition "${requisition.title}" — Total: ${totalCost.toLocaleString()} RWF`,
      data: { requisitionId: requisition.id },
      io,
    });

    // ── 6. Audit log ──────────────────────────────────────────────────────────
    await createAuditLog({
      userId: req.user.id,
      role: req.user.role,
      action: 'FULFILL_REQUISITION',
      description: `Fulfilled requisition "${requisition.title}" — ${items.length} items, total ${totalCost} RWF`,
      tableName: 'Requisition',
      recordId: requisition.id,
    });

    return res.status(201).json({ success: true, data: result.updatedRequisition });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
