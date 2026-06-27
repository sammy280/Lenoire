const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const prisma = require('../config/database');
const { createNotification } = require('../services/notification.service');
const { createAuditLog } = require('../middleware/audit');

router.use(authenticate);

// GET /returns
router.get('/', async (req, res, next) => {
  try {
    const { status } = req.query;
    const where = {};
    if (status) where.status = status;
    if (req.user.role === 'WAITER') where.requestedById = req.user.id;

    const returns = await prisma.returnRequest.findMany({
      where,
      include: {
        order: { include: { table: true, seat: true } },
        items: { include: { orderItem: { include: { product: true } } } },
        requestedBy:     { select: { id: true, name: true, role: true } },
        reviewedBy:      { select: { id: true, name: true } },
        managerApprover: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: returns });
  } catch (err) { next(err); }
});

// POST /returns  (waiter)
router.post('/', async (req, res, next) => {
  try {
    const { orderId, items, reason } = req.body;
    const io = req.app.get('io');

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { table: true, seat: true, items: { include: { product: true } } },
    });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const enriched = items.map(i => ({
      ...i,
      type: order.items.find(oi => oi.id === i.orderItemId)?.type,
    }));

    const returnReq = await prisma.returnRequest.create({
      data: {
        orderId,
        reason,
        requestedById: req.user.id,
        items: {
          create: items.map(i => ({
            orderItemId: i.orderItemId,
            quantity:    i.quantity,
            reason:      i.reason || null,
          })),
        },
      },
      include: {
        items: { include: { orderItem: { include: { product: true } } } },
        requestedBy: { select: { id: true, name: true } },
      },
    });

    const hasDrink = enriched.some(i => i.type === 'DRINK');
    const hasFood  = enriched.some(i => i.type === 'FOOD');

    if (hasDrink) {
      await createNotification({
        roles: ['BAR'], type: 'RETURN_REQUEST',
        title: '🔄 Return Request',
        message: `${req.user.name} wants to return drinks — Table ${order.table.name} ${order.seat.label}. Reason: ${reason}`,
        data: { returnId: returnReq.id }, io,
      });
    }
    if (hasFood) {
      await createNotification({
        roles: ['KITCHEN'], type: 'RETURN_REQUEST',
        title: '🔄 Return Request',
        message: `${req.user.name} wants to return food — Table ${order.table.name} ${order.seat.label}. Reason: ${reason}`,
        data: { returnId: returnReq.id }, io,
      });
    }

    res.status(201).json({ success: true, data: returnReq });
  } catch (err) { next(err); }
});

// PATCH /returns/:id/review  (Bar or Kitchen)
router.patch('/:id/review', authorize('BAR', 'KITCHEN', 'MANAGER', 'ADMIN'), async (req, res, next) => {
  try {
    const { approved, reviewNote } = req.body;
    const io = req.app.get('io');

    const existing = await prisma.returnRequest.findUnique({
      where: { id: req.params.id },
      include: { requestedBy: true, order: { include: { table: true, seat: true } } },
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Not found' });
    if (existing.status !== 'PENDING') {
      return res.status(400).json({ success: false, message: 'Already reviewed' });
    }

    const newStatus = !approved
      ? 'REJECTED'
      : req.user.role === 'BAR' ? 'APPROVED_BY_BAR' : 'APPROVED_BY_KITCHEN';

    await prisma.returnRequest.update({
      where: { id: req.params.id },
      data: { status: newStatus, reviewedById: req.user.id, reviewNote, reviewedAt: new Date() },
    });

    if (approved) {
      await createNotification({
        roles: ['CASHIER', 'MANAGER', 'ADMIN'], type: 'RETURN_REQUEST',
        title: '⏳ Return Needs Cashier Validation',
        message: `Return approved by ${req.user.name} (${req.user.role}) — Table ${existing.order.table.name} ${existing.order.seat.label}. Please validate.`,
        data: { returnId: existing.id }, io,
      });
    }

    await createNotification({
      userIds: [existing.requestedById], type: 'RETURN_REQUEST',
      title: approved ? '✅ Return Approved by Dept' : '❌ Return Rejected',
      message: approved
        ? `Your return was approved by ${req.user.name}. Awaiting cashier validation.`
        : `Your return was rejected by ${req.user.name}. ${reviewNote || ''}`,
      data: { returnId: existing.id }, io,
    });

    res.json({ success: true, data: await prisma.returnRequest.findUnique({ where: { id: req.params.id } }) });
  } catch (err) { next(err); }
});

// PATCH /returns/:id/manager-review  (Cashier / Manager final validation)
router.patch('/:id/manager-review', authorize('CASHIER', 'MANAGER', 'ADMIN'), async (req, res, next) => {
  try {
    const { approved, managerNote } = req.body;
    const io = req.app.get('io');

    const existing = await prisma.returnRequest.findUnique({
      where: { id: req.params.id },
      include: {
        requestedBy: true,
        order: { include: { table: true, seat: true } },
        items: {
          include: {
            orderItem: {
              include: { product: { include: { inventoryLinks: true } } },
            },
          },
        },
      },
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Not found' });

    const deptApproved = ['APPROVED_BY_BAR', 'APPROVED_BY_KITCHEN'].includes(existing.status);
    if (!deptApproved) {
      return res.status(400).json({ success: false, message: 'Awaiting Bar/Kitchen approval first' });
    }

    const newStatus = approved ? 'MANAGER_APPROVED' : 'MANAGER_REJECTED';

    await prisma.$transaction(async (tx) => {
      await tx.returnRequest.update({
        where: { id: req.params.id },
        data: {
          status:             newStatus,
          managerApproverId:  req.user.id,
          managerNote,
          managerActedAt:     new Date(),
          restockDone:        approved,
        },
      });

      if (approved) {
        for (const ri of existing.items) {
          const links = ri.orderItem.product.inventoryLinks;
          for (const link of links) {
            const current = await tx.inventoryItem.findUnique({ where: { id: link.inventoryItemId } });
            const addQty  = parseFloat(link.quantity) * ri.quantity;
            await tx.inventoryItem.update({
              where: { id: link.inventoryItemId },
              data:  { quantity: { increment: addQty } },
            });
            await tx.stockMovement.create({
              data: {
                inventoryItemId: link.inventoryItemId,
                type:            'IN',
                quantity:        addQty,
                previousQty:     parseFloat(current.quantity),
                newQty:          parseFloat(current.quantity) + addQty,
                reason:          `Return #${req.params.id.slice(-6).toUpperCase()} validated`,
                reference:       req.params.id,
                userId:          req.user.id,
              },
            });
          }
        }

        await createAuditLog({
          userId: req.user.id, role: req.user.role,
          action: 'APPROVE_RETURN',
          description: `Return #${req.params.id.slice(-6).toUpperCase()} validated — Table ${existing.order.table.name}`,
          tableName: 'ReturnRequest', recordId: req.params.id,
        });
      }
    });

    await createNotification({
      userIds: [existing.requestedById], type: 'RETURN_REQUEST',
      title: approved ? '✅ Return Fully Validated' : '❌ Return Rejected by Cashier',
      message: approved
        ? 'Cashier has validated your return. Stock has been restored.'
        : `Cashier rejected your return: ${managerNote || ''}`,
      data: { returnId: existing.id }, io,
    });

    res.json({ success: true, data: await prisma.returnRequest.findUnique({ where: { id: req.params.id } }) });
  } catch (err) { next(err); }
});

module.exports = router;