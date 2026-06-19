const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const prisma = require('../config/database');
const { createNotification } = require('../services/notification.service');
const { createAuditLog } = require('../middleware/audit');

router.use(authenticate);

// List return requests
router.get('/', async (req, res, next) => {
  try {
    const { status } = req.query;
    const where = {};
    if (status) where.status = status;
    // Waiters only see their own
    if (req.user.role === 'WAITER') where.requestedById = req.user.id;

    const returns = await prisma.returnRequest.findMany({
      where,
      include: {
        order: { include: { table: true, seat: true } },
        items: { include: { orderItem: { include: { product: true } } } },
        requestedBy: { select: { id: true, name: true, role: true } },
        reviewedBy: { select: { id: true, name: true } },
        managerApprover: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: returns });
  } catch (err) { next(err); }
});

// Create return request (waiter)
router.post('/', async (req, res, next) => {
  try {
    const { orderId, items, reason } = req.body;
    const io = req.app.get('io');

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { table: true, seat: true, items: { include: { product: true } } },
    });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    // Check which dept to notify (food → kitchen, drink → bar)
    const returnItemsEnriched = items.map(i => {
      const orderItem = order.items.find(oi => oi.id === i.orderItemId);
      return { ...i, type: orderItem?.type };
    });

    const returnReq = await prisma.returnRequest.create({
      data: {
        orderId,
        reason,
        requestedById: req.user.id,
        items: {
          create: items.map(i => ({ orderItemId: i.orderItemId, quantity: i.quantity, reason: i.reason })),
        },
      },
      include: { items: { include: { orderItem: { include: { product: true } } } }, requestedBy: { select: { id: true, name: true } } },
    });

    const hasDrink = returnItemsEnriched.some(i => i.type === 'DRINK');
    const hasFood = returnItemsEnriched.some(i => i.type === 'FOOD');

    if (hasDrink) {
      await createNotification({ roles: ['BAR'], type: 'RETURN_REQUEST', title: '🔄 Return Request', message: `${req.user.name} wants to return drinks from Table ${order.table.name} ${order.seat.label}. Reason: ${reason}`, data: { returnId: returnReq.id }, io });
    }
    if (hasFood) {
      await createNotification({ roles: ['KITCHEN'], type: 'RETURN_REQUEST', title: '🔄 Return Request', message: `${req.user.name} wants to return food from Table ${order.table.name} ${order.seat.label}. Reason: ${reason}`, data: { returnId: returnReq.id }, io });
    }
    await createNotification({ roles: ['MANAGER', 'ADMIN'], type: 'RETURN_REQUEST', title: '🔄 Return Request Created', message: `Waiter ${req.user.name}: return request for Table ${order.table.name}`, data: { returnId: returnReq.id }, io });

    res.status(201).json({ success: true, data: returnReq });
  } catch (err) { next(err); }
});

// Bar/Kitchen review (approve or reject)
router.patch('/:id/review', authorize('BAR', 'KITCHEN', 'MANAGER', 'ADMIN'), async (req, res, next) => {
  try {
    const { status, reviewNote } = req.body; // APPROVED_BY_BAR / APPROVED_BY_KITCHEN / REJECTED
    const io = req.app.get('io');

    const existing = await prisma.returnRequest.findUnique({
      where: { id: req.params.id },
      include: { requestedBy: true, order: { include: { table: true, seat: true } } },
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Not found' });

    const updated = await prisma.returnRequest.update({
      where: { id: req.params.id },
      data: { status, reviewedById: req.user.id, reviewNote, reviewedAt: new Date() },
    });

    const isApproved = ['APPROVED_BY_BAR', 'APPROVED_BY_KITCHEN'].includes(status);
    await createNotification({
      userIds: [existing.requestedById],
      type: 'RETURN_REQUEST',
      title: isApproved ? '✅ Return Approved (Bar/Kitchen)' : '❌ Return Rejected',
      message: isApproved
        ? `Your return request was approved by ${req.user.name}. Awaiting manager final approval.`
        : `Your return request was rejected by ${req.user.name}. ${reviewNote || ''}`,
      data: { returnId: existing.id },
      io,
    });

    if (isApproved) {
      await createNotification({
        roles: ['MANAGER', 'ADMIN'],
        type: 'RETURN_REQUEST',
        title: '⏳ Return Needs Manager Approval',
        message: `Return request approved by ${req.user.name} — awaiting your final approval. Table ${existing.order.table.name}`,
        data: { returnId: existing.id },
        io,
      });
    }

    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});

// Manager final decision
router.patch('/:id/manager-review', authorize('MANAGER', 'ADMIN'), async (req, res, next) => {
  try {
    const { status, managerNote } = req.body; // MANAGER_APPROVED / MANAGER_REJECTED
    const io = req.app.get('io');

    const existing = await prisma.returnRequest.findUnique({
      where: { id: req.params.id },
      include: {
        requestedBy: true,
        items: { include: { orderItem: { include: { product: { include: { category: true } } } } } },
      },
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Not found' });

    const updated = await prisma.returnRequest.update({
      where: { id: req.params.id },
      data: { status, managerApproverId: req.user.id, managerNote, managerActedAt: new Date() },
    });

    if (status === 'MANAGER_APPROVED') {
      // Restock inventory for returned items (if product has inventory link)
      for (const ri of existing.items) {
        const product = ri.orderItem.product;
        // Find inventory links for this product
        const links = await prisma.productInventory.findMany({ where: { productId: product.id } });
        for (const link of links) {
          await prisma.inventoryItem.update({
            where: { id: link.inventoryItemId },
            data: { quantity: { increment: parseFloat(link.quantityUsed) * ri.quantity } },
          });
        }
      }
      await prisma.returnRequest.update({ where: { id: req.params.id }, data: { restockDone: true } });

      await createAuditLog({
        userId: req.user.id, role: req.user.role, action: 'APPROVE_RETURN',
        description: `Manager approved return request #${req.params.id}`,
        tableName: 'ReturnRequest', recordId: req.params.id,
      });
    }

    await createNotification({
      userIds: [existing.requestedById],
      type: 'RETURN_REQUEST',
      title: status === 'MANAGER_APPROVED' ? '✅ Return Fully Approved' : '❌ Return Rejected by Manager',
      message: status === 'MANAGER_APPROVED'
        ? 'Manager has fully approved your return request. Stock has been updated.'
        : `Manager rejected your return: ${managerNote || ''}`,
      data: { returnId: existing.id },
      io,
    });

    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});

module.exports = router;
