const prisma = require('../config/database');
const { createAuditLog } = require('../middleware/audit');
const { emitToUser, emitToRole, emitToRoles } = require('../config/socket');
const { createNotification } = require('../services/notification.service');
const { deductInventory } = require('../services/inventory.service');
const { getLocalDayRange } = require('./analytics.controller');

const generateOrderNumber = () => `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
const ACTIVE_STATUSES = ['PENDING', 'PREPARING', 'READY', 'SERVED'];
const HISTORY_STATUSES = ['COMPLETED', 'CANCELLED'];
const getOrders = async (req, res, next) => {
  try {
    const { status, waiterId, tableId, date } = req.query;
    const where = {};
    if (status) {
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
      where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
    }
    if (waiterId) where.waiterId = waiterId;
    if (tableId) where.tableId = tableId;
    if (date) {
      const d = new Date(date);
      where.createdAt = { gte: d, lt: new Date(d.getTime() + 86400000) };
    }

    if (req.user.role === 'WAITER') where.waiterId = req.user.id;

    const orders = await prisma.order.findMany({
      where,
      include: {
        items: { include: { product: { include: { category: true } } } },
        table: true,
        seat: true,
        waiter: { select: { id: true, name: true } },
        kitchenOrder: true,
        barOrder: true,
        bill: { select: { id: true, billNumber: true, total: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: orders });
  } catch (err) { next(err); }
};

const getOrderById = async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        items: { include: { product: { include: { category: true } } } },
        table: true,
        seat: true,
        waiter: { select: { id: true, name: true } },
        kitchenOrder: true,
        barOrder: true,
        bill: { include: { payment: true } },
      },
    });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, data: order });
  } catch (err) { next(err); }
};
const getActiveOrders = async (req, res, next) => {
  try {
    const where = { status: { in: ACTIVE_STATUSES } };
    if (req.user.role === 'WAITER') where.waiterId = req.user.id;

    const orders = await prisma.order.findMany({
      where,
      include: {
        items: { include: { product: { include: { category: true } } } },
        table: true,
        seat: true,
        waiter: { select: { id: true, name: true } },
        kitchenOrder: true,
        barOrder: true,
        bill: { select: { id: true, billNumber: true, total: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: orders });
  } catch (err) { next(err); }
};

const getOrderHistory = async (req, res, next) => {
  try {
    const { range = 'today', startDate, endDate } = req.query;
    let start, end;

    if (range === 'custom' && startDate && endDate) {
      start = new Date(startDate);
      end = new Date(new Date(endDate).getTime() + 86400000);
    } else {
      const { start: todayStart, end: todayEnd } = getLocalDayRange();
      if (range === 'today') {
        start = todayStart; end = todayEnd;
      } else if (range === 'yesterday') {
        start = new Date(todayStart.getTime() - 86400000);
        end = todayStart;
      } else if (range === 'week') {
        start = new Date(todayStart.getTime() - 7 * 86400000);
        end = todayEnd;
      } else if (range === 'month') {
        start = new Date(todayStart.getTime() - 30 * 86400000);
        end = todayEnd;
      } else {
        start = todayStart; end = todayEnd;
      }
    }

    const orders = await prisma.order.findMany({
      where: { status: { in: HISTORY_STATUSES }, createdAt: { gte: start, lt: end } },
      include: {
        items: { include: { product: true } },
        table: true,
        seat: true,
        waiter: { select: { id: true, name: true } },
        bill: { include: { payment: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: orders });
  } catch (err) { next(err); }
};
const createOrder = async (req, res, next) => {
  try {
    const { tableId, seatId, items, notes } = req.body;
    const io = req.app.get('io');

    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Order must have at least one item' });
    }

    const productIds = items.map(i => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { category: true },
    });
    const productMap = Object.fromEntries(products.map(p => [p.id, p]));

    const enrichedItems = items.map(item => {
      const product = productMap[item.productId];
      if (!product) throw new Error(`Product ${item.productId} not found`);
      return { ...item, unitPrice: product.price, type: product.category.type };
    });

    const foodItems = enrichedItems.filter(i => i.type === 'FOOD');
    const drinkItems = enrichedItems.filter(i => i.type === 'DRINK');

    const existingOrder = tableId && seatId ? await prisma.order.findFirst({
      where: {
        tableId,
        seatId,
        waiterId: req.user.id,
        status: { notIn: ['CANCELLED'] },
        OR: [
          { bill: { is: null } },
          { bill: { status: { not: 'PAID' } } },
        ],
      },
      include: {
        items: { include: { product: true } },
        table: true,
        seat: true,
        kitchenOrder: true,
        barOrder: true,
        bill: true,
      },
      orderBy: { createdAt: 'desc' },
    }) : null;

    let order;
    let isAddition = false;

    if (existingOrder) {
      isAddition = true;

      // ── Determine next batch number ───────────────────────────────────────
      // BUG 3 FIX: Each addition gets a new batchNumber. The KDS filters
      // items by batchNumber == kitchenOrder.currentBatch, so old served
      // items (batch 1) never appear on a new ticket (batch 2+).
      const existingBatch = Math.max(
        existingOrder.kitchenOrder?.currentBatch ?? 1,
        existingOrder.barOrder?.currentBatch ?? 1,
      );
      const newBatch = existingBatch + 1;

      // Append new items tagged with the new batch number
      await prisma.orderItem.createMany({
        data: enrichedItems.map(i => ({
          orderId: existingOrder.id,
          productId: i.productId,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          notes: i.notes,
          type: i.type,
          batchNumber: newBatch,
        })),
      });

      // Reset order status back to PENDING
      await prisma.order.update({
        where: { id: existingOrder.id },
        data: { status: 'PENDING' },
      });

      // Kitchen: reset status + bump currentBatch
      if (foodItems.length > 0) {
        if (!existingOrder.kitchenOrder) {
          await prisma.kitchenOrder.create({
            data: { orderId: existingOrder.id, currentBatch: newBatch },
          });
        } else {
          await prisma.kitchenOrder.update({
            where: { orderId: existingOrder.id },
            data: { status: 'PENDING', currentBatch: newBatch },
          });
        }
      }

      // Bar: reset status + bump currentBatch
      if (drinkItems.length > 0) {
        if (!existingOrder.barOrder) {
          await prisma.barOrder.create({
            data: { orderId: existingOrder.id, currentBatch: newBatch },
          });
        } else {
          await prisma.barOrder.update({
            where: { orderId: existingOrder.id },
            data: { status: 'PENDING', currentBatch: newBatch },
          });
        }
      }

      // ── BUG 4 FIX: Recalculate bill total if a bill already exists ────────
      // The bill was a snapshot of the original order total. New items were
      // never counted so the waiter's preview showed the wrong (old) total.
      if (existingOrder.bill && existingOrder.bill.status !== 'PAID') {
        const allItems = await prisma.orderItem.findMany({
          where: { orderId: existingOrder.id },
        });
        const newSubtotal = allItems.reduce(
          (sum, item) => sum + parseFloat(item.unitPrice) * item.quantity,
          0,
        );
        const tax = parseFloat(existingOrder.bill.tax ?? 0);
        const discount = parseFloat(existingOrder.bill.discount ?? 0);
        const newTotal = newSubtotal + tax - discount;

        await prisma.bill.update({
          where: { id: existingOrder.bill.id },
          data: { subtotal: newSubtotal, total: newTotal },
        });
      }

      order = await prisma.order.findUnique({
        where: { id: existingOrder.id },
        include: {
          items: { include: { product: true } },
          table: true,
          seat: true,
          kitchenOrder: true,
          barOrder: true,
          bill: { select: { id: true, billNumber: true, total: true, status: true } },
        },
      });
    } else {
      // Brand new order — batch 1
      order = await prisma.order.create({
        data: {
          orderNumber: generateOrderNumber(),
          tableId,
          seatId,
          waiterId: req.user.id,
          createdById: req.user.id,
          notes,
          isSent: true,
          items: {
            create: enrichedItems.map(i => ({
              productId: i.productId,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              notes: i.notes,
              type: i.type,
              batchNumber: 1,
            })),
          },
          kitchenOrder: foodItems.length > 0 ? { create: { currentBatch: 1 } } : undefined,
          barOrder: drinkItems.length > 0 ? { create: { currentBatch: 1 } } : undefined,
        },
        include: {
          items: { include: { product: true } },
          table: true,
          seat: true,
          kitchenOrder: true,
          barOrder: true,
        },
      });

      await prisma.restaurantTable.update({ where: { id: tableId }, data: { status: 'OCCUPIED' } });
      await prisma.seat.update({ where: { id: seatId }, data: { isOccupied: true } });
    }

    // ── Notifications ─────────────────────────────────────────────────────
    if (foodItems.length > 0) {
      await createNotification({
        roles: ['KITCHEN'],
        type: 'ORDER_UPDATE',
        title: isAddition ? 'Additional Food Items' : 'New Food Order',
        message: isAddition
          ? `${foodItems.length} more food item(s) added to Order #${order.orderNumber} — Table ${order.table.name} ${order.seat.label}`
          : `New food order for Table ${order.table.name} Seat ${order.seat.label} - Order #${order.orderNumber}`,
        data: { orderId: order.id, newItems: foodItems.map(i => ({ productId: i.productId, quantity: i.quantity })) },
        io,
      });
    }

    if (drinkItems.length > 0) {
      await createNotification({
        roles: ['BAR'],
        type: 'ORDER_UPDATE',
        title: isAddition ? 'Additional Drink Items' : 'New Drink Order',
        message: isAddition
          ? `${drinkItems.length} more drink item(s) added to Order #${order.orderNumber} — Table ${order.table.name} ${order.seat.label}`
          : `New drink order for Table ${order.table.name} Seat ${order.seat.label} - Order #${order.orderNumber}`,
        data: { orderId: order.id, newItems: drinkItems.map(i => ({ productId: i.productId, quantity: i.quantity })) },
        io,
      });
    }

    // ── Print tickets ─────────────────────────────────────────────────────
    const newBatchForTicket = isAddition
      ? Math.max(order.kitchenOrder?.currentBatch ?? 1, order.barOrder?.currentBatch ?? 1)
      : 1;

    const ticketContent = {
      orderNumber: order.orderNumber,
      table: order.table?.name,
      seat: order.seat?.label,
      waiter: req.user.name,
      notes: notes || '',
      isAddition,
      batchNumber: newBatchForTicket,
      timestamp: new Date().toISOString(),
    };

    if (foodItems.length > 0) {
      const kitchenContent = JSON.stringify({
        ...ticketContent,
        items: foodItems.map(i => ({ name: productMap[i.productId]?.name, qty: i.quantity, notes: i.notes })),
      });
      await prisma.printLog.create({
        data: {
          jobType: 'KITCHEN_TICKET',
          title: `Kitchen — ${order.table?.name} ${order.seat?.label}`,
          content: kitchenContent,
          targetPrinter: 'kitchen',
          orderId: order.id,
          printedById: req.user.id,
        },
      });
      io?.to('printer:kitchen').emit('print:job', {
        jobType: 'KITCHEN_TICKET',
        content: JSON.parse(kitchenContent),
        orderId: order.id,
      });
    }

    if (drinkItems.length > 0) {
      const barContent = JSON.stringify({
        ...ticketContent,
        items: drinkItems.map(i => ({ name: productMap[i.productId]?.name, qty: i.quantity, notes: i.notes })),
      });
      await prisma.printLog.create({
        data: {
          jobType: 'BAR_TICKET',
          title: `Bar — ${order.table?.name} ${order.seat?.label}`,
          content: barContent,
          targetPrinter: 'bar',
          orderId: order.id,
          printedById: req.user.id,
        },
      });
      io?.to('printer:bar').emit('print:job', {
        jobType: 'BAR_TICKET',
        content: JSON.parse(barContent),
        orderId: order.id,
      });
    }

    io.to('role:KITCHEN').to('role:BAR').to('role:MANAGER').to('role:ADMIN').to('role:CASHIER').emit(
      isAddition ? 'order:updated' : 'order:new',
      order,
    );

    await createAuditLog({
      userId: req.user.id,
      role: req.user.role,
      action: isAddition ? 'ADD_TO_ORDER' : 'CREATE_ORDER',
      description: isAddition
        ? `Added items to order ${order.orderNumber}`
        : `Created order ${order.orderNumber}`,
      tableName: 'Order',
      recordId: order.id,
    });

    res.status(isAddition ? 200 : 201).json({
      success: true,
      data: order,
      message: isAddition ? 'Items added to existing order' : 'Order created successfully',
      isAddition,
    });
  } catch (err) { next(err); }
};

const cancelOrder = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    if (req.user.role === 'WAITER') {
      if (order.isSent) return res.status(403).json({ success: false, message: 'Cannot cancel an order already sent' });
    }

    const updated = await prisma.order.update({
      where: { id: req.params.id },
      data: { status: 'CANCELLED', cancelReason: reason, cancelledBy: req.user.id },
    });

    const io = req.app.get('io');
    io.emit('order:cancelled', updated);

    if (req.user.role !== 'WAITER' && order.waiterId !== req.user.id) {
      await createNotification({
        userIds: [order.waiterId],
        type: 'ORDER_UPDATE',
        title: 'Order Cancelled',
        message: `Order #${order.orderNumber} was cancelled by ${req.user.name}. Reason: ${reason}`,
        data: { orderId: order.id },
        io,
      });
    }

    await createAuditLog({
      userId: req.user.id,
      role: req.user.role,
      action: 'CANCEL_ORDER',
      description: `Cancelled order ${order.orderNumber}: ${reason}`,
      tableName: 'Order',
      recordId: order.id,
    });

    res.json({ success: true, data: updated, message: 'Order cancelled' });
  } catch (err) { next(err); }
};

const markServed = async (req, res, next) => {
  try {
    const existing = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { kitchenOrder: true, barOrder: true },
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Order not found' });
    if (req.user.role === 'WAITER' && existing.waiterId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'You can only mark your own orders as served' });
    }
    if (existing.status === 'SERVED') {
      return res.status(409).json({ success: false, message: 'Order already marked as served' });
    }

    await prisma.$transaction([
      prisma.order.update({
        where: { id: req.params.id },
        data: { status: 'SERVED' },
      }),
      ...(existing.kitchenOrder ? [
        prisma.kitchenOrder.update({
          where: { orderId: req.params.id },
          data: { status: 'SERVED' },
        }),
      ] : []),
      ...(existing.barOrder ? [
        prisma.barOrder.update({
          where: { orderId: req.params.id },
          data: { status: 'SERVED' },
        }),
      ] : []),
    ]);

    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { table: true, seat: true, kitchenOrder: true, barOrder: true },
    });

    const io = req.app.get('io');
    io.emit('order:served', order);
    res.json({ success: true, data: order });
  } catch (err) { next(err); }
};

const requestBill = async (req, res, next) => {
  try {
    const io = req.app.get('io');

    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { table: true, seat: true, waiter: true },
    });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.waiterId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not your order' });
    }
    if (order.status !== 'SERVED') {
      return res.status(400).json({ success: false, message: 'Order must be marked served before requesting a bill' });
    }
    if (order.billRequested) {
      return res.status(409).json({ success: false, message: 'Bill already requested' });
    }

    await prisma.order.update({ where: { id: order.id }, data: { billRequested: true } });

    await createNotification({
      roles: ['CASHIER'],
      type: 'BILL_UPDATE',
      title: '🧾 Bill Requested',
      message: `${req.user.name} (Waiter) is requesting a bill for Table ${order.table.name} Seat ${order.seat.label} — Order #${order.orderNumber}`,
      data: { orderId: order.id },
      io,
    });

    await createNotification({
      roles: ['MANAGER', 'ADMIN'],
      type: 'BILL_UPDATE',
      title: 'Bill Requested',
      message: `Table ${order.table.name} ${order.seat.label} — Bill requested by ${req.user.name}`,
      data: { orderId: order.id },
      io,
    });

    res.json({ success: true, message: 'Bill requested. Cashier has been notified.' });
  } catch (err) { next(err); }
};

// ── MERGE TABLES ─────────────────────────────────────────────────────────────
const mergeTables = async (req, res, next) => {
  try {
    const { sourceTableId, destinationTableId } = req.body;
    const io = req.app.get('io');

    if (!sourceTableId || !destinationTableId) {
      return res.status(400).json({ success: false, message: 'sourceTableId and destinationTableId are required' });
    }
    if (sourceTableId === destinationTableId) {
      return res.status(400).json({ success: false, message: 'Source and destination tables must be different' });
    }

    const [sourceTable, destTable] = await Promise.all([
      prisma.restaurantTable.findUnique({ where: { id: sourceTableId }, include: { seats: true } }),
      prisma.restaurantTable.findUnique({ where: { id: destinationTableId }, include: { seats: true } }),
    ]);
    if (!sourceTable) return res.status(404).json({ success: false, message: 'Source table not found' });
    if (!destTable) return res.status(404).json({ success: false, message: 'Destination table not found' });

    const sourceOrders = await prisma.order.findMany({
      where: {
        tableId: sourceTableId,
        status: { notIn: ['CANCELLED'] },
        OR: [
          { bill: { is: null } },
          { bill: { status: { not: 'PAID' } } },
        ],
      },
      include: { items: true, kitchenOrder: true, barOrder: true, seat: true },
    });

    if (sourceOrders.length === 0) {
      return res.status(400).json({ success: false, message: 'No open orders found on source table' });
    }

    const destSeats = destTable.seats;
    if (destSeats.length === 0) {
      return res.status(400).json({ success: false, message: 'Destination table has no seats' });
    }

    const mergedOrderIds = [];

    for (const srcOrder of sourceOrders) {
      const srcSeatIndex = sourceTable.seats.findIndex(s => s.id === srcOrder.seatId);
      const destSeat = destSeats[srcSeatIndex] ?? destSeats[0];

      await prisma.order.update({
        where: { id: srcOrder.id },
        data: { tableId: destinationTableId, seatId: destSeat.id },
      });

      await prisma.seat.update({ where: { id: destSeat.id }, data: { isOccupied: true } });
      mergedOrderIds.push(srcOrder.id);

      const kdsPayload = {
        orderId: srcOrder.id,
        fromTable: sourceTable.name,
        toTable: destTable.name,
        toSeat: destSeat.label,
      };

      if (srcOrder.kitchenOrder && srcOrder.kitchenOrder.status !== 'READY') {
        io?.to('role:KITCHEN').emit('order:table_moved', kdsPayload);
      }
      if (srcOrder.barOrder && srcOrder.barOrder.status !== 'READY') {
        io?.to('role:BAR').emit('order:table_moved', kdsPayload);
      }
    }

    await prisma.restaurantTable.update({ where: { id: sourceTableId }, data: { status: 'AVAILABLE' } });
    await prisma.seat.updateMany({ where: { tableId: sourceTableId }, data: { isOccupied: false } });
    await prisma.restaurantTable.update({ where: { id: destinationTableId }, data: { status: 'OCCUPIED' } });

    const mergedOrders = await prisma.order.findMany({
      where: { id: { in: mergedOrderIds } },
      include: {
        items: { include: { product: true } },
        table: true,
        seat: true,
        waiter: { select: { id: true, name: true } },
        kitchenOrder: true,
        barOrder: true,
        bill: { select: { id: true, billNumber: true, total: true, status: true } },
      },
    });

    io.to('role:KITCHEN').to('role:BAR').to('role:MANAGER').to('role:ADMIN').to('role:CASHIER').to('role:WAITER').emit('tables:merged', {
      sourceTable: sourceTable.name,
      destinationTable: destTable.name,
      mergedOrders,
    });

    await createNotification({
      roles: ['MANAGER', 'ADMIN'],
      type: 'ORDER_UPDATE',
      title: '🔀 Tables Merged',
      message: `Table ${sourceTable.name} merged into Table ${destTable.name} by ${req.user.name}. ${sourceOrders.length} order(s) moved.`,
      data: { sourceTableId, destinationTableId },
      io,
    });

    await createAuditLog({
      userId: req.user.id,
      role: req.user.role,
      action: 'MERGE_TABLES',
      description: `Merged Table ${sourceTable.name} into Table ${destTable.name}. Orders: ${sourceOrders.map(o => o.orderNumber).join(', ')}`,
      tableName: 'RestaurantTable',
      recordId: destinationTableId,
    });

    res.json({
      success: true,
      message: `Table ${sourceTable.name} merged into Table ${destTable.name} successfully`,
      data: {
        sourceTable: sourceTable.name,
        destinationTable: destTable.name,
        ordersTransferred: sourceOrders.length,
        mergedOrders,
      },
    });
  } catch (err) { next(err); }
};

module.exports = { getOrders, getOrderById, createOrder, cancelOrder, markServed, requestBill, mergeTables, getActiveOrders, getOrderHistory };