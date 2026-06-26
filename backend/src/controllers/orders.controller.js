const prisma = require('../config/database');
const { createAuditLog } = require('../middleware/audit');
const { emitToUser, emitToRole, emitToRoles } = require('../config/socket');
const { createNotification } = require('../services/notification.service');
const { deductInventory } = require('../services/inventory.service');

const generateOrderNumber = () => `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

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

    // Waiters only see their own orders
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

const createOrder = async (req, res, next) => {
  try {
    const { tableId, seatId, items, notes } = req.body;
    const io = req.app.get('io');

    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Order must have at least one item' });
    }

    // Validate products and prices
    const productIds = items.map(i => i.productId);
    const products = await prisma.product.findMany({ where: { id: { in: productIds } }, include: { category: true } });
    const productMap = Object.fromEntries(products.map(p => [p.id, p]));

    const enrichedItems = items.map(item => {
      const product = productMap[item.productId];
      if (!product) throw new Error(`Product ${item.productId} not found`);
      return { ...item, unitPrice: product.price, type: product.category.type };
    });

    const foodItems = enrichedItems.filter(i => i.type === 'FOOD');
    const drinkItems = enrichedItems.filter(i => i.type === 'DRINK');

    // FIX 1: Scope to this waiter's own orders only (waiterId: req.user.id)
    // FIX 2: Removed bill: { is: null } — a seat on a table where ANOTHER seat
    //         has a bill should not be blocked. We scope strictly to seatId,
    //         and only exclude orders that are already billed+paid (bill.status PAID).
    const existingOrder = tableId && seatId ? await prisma.order.findFirst({
      where: {
        tableId,
        seatId,
        waiterId: req.user.id,          // FIX 1: own orders only
        status: { notIn: ['CANCELLED'] },
        OR: [
          { bill: { is: null } },        // no bill yet
          { bill: { status: { not: 'PAID' } } }, // bill exists but not paid yet
        ],
      },
      include: {
        items: { include: { product: true } },
        table: true,
        seat: true,
        kitchenOrder: true,
        barOrder: true,
      },
      orderBy: { createdAt: 'desc' },
    }) : null;

    let order;
    let isAddition = false;

    if (existingOrder) {
      isAddition = true;
      await prisma.orderItem.createMany({
        data: enrichedItems.map(i => ({
          orderId: existingOrder.id,
          productId: i.productId,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          notes: i.notes,
          type: i.type,
        })),
      });

      if (foodItems.length > 0 && !existingOrder.kitchenOrder) {
        await prisma.kitchenOrder.create({ data: { orderId: existingOrder.id } });
      }
      if (drinkItems.length > 0 && !existingOrder.barOrder) {
        await prisma.barOrder.create({ data: { orderId: existingOrder.id } });
      }

      order = await prisma.order.findUnique({
        where: { id: existingOrder.id },
        include: {
          items: { include: { product: true } },
          table: true,
          seat: true,
          kitchenOrder: true,
          barOrder: true,
        },
      });
    } else {
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
            })),
          },
          kitchenOrder: foodItems.length > 0 ? { create: {} } : undefined,
          barOrder: drinkItems.length > 0 ? { create: {} } : undefined,
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

    const ticketContent = {
      orderNumber: order.orderNumber,
      table: order.table?.name,
      seat: order.seat?.label,
      waiter: req.user.name,
      notes: notes || '',
      isAddition,
      timestamp: new Date().toISOString(),
    };

    if (foodItems.length > 0) {
      const kitchenContent = JSON.stringify({ ...ticketContent, items: foodItems.map(i => ({ name: productMap[i.productId]?.name, qty: i.quantity, notes: i.notes })) });
      await prisma.printLog.create({
        data: { jobType: 'KITCHEN_TICKET', title: `Kitchen — ${order.table?.name} ${order.seat?.label}`, content: kitchenContent, targetPrinter: 'kitchen', orderId: order.id, printedById: req.user.id },
      });
      io?.to('printer:kitchen').emit('print:job', { jobType: 'KITCHEN_TICKET', content: JSON.parse(kitchenContent), orderId: order.id });
    }
    if (drinkItems.length > 0) {
      const barContent = JSON.stringify({ ...ticketContent, items: drinkItems.map(i => ({ name: productMap[i.productId]?.name, qty: i.quantity, notes: i.notes })) });
      await prisma.printLog.create({
        data: { jobType: 'BAR_TICKET', title: `Bar — ${order.table?.name} ${order.seat?.label}`, content: barContent, targetPrinter: 'bar', orderId: order.id, printedById: req.user.id },
      });
      io?.to('printer:bar').emit('print:job', { jobType: 'BAR_TICKET', content: JSON.parse(barContent), orderId: order.id });
    }

    io.to('role:KITCHEN').to('role:BAR').to('role:MANAGER').to('role:ADMIN').to('role:CASHIER').emit(
      isAddition ? 'order:updated' : 'order:new',
      order
    );

    await createAuditLog({
      userId: req.user.id, role: req.user.role,
      action: isAddition ? 'ADD_TO_ORDER' : 'CREATE_ORDER',
      description: isAddition ? `Added items to order ${order.orderNumber}` : `Created order ${order.orderNumber}`,
      tableName: 'Order', recordId: order.id,
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

    await createAuditLog({ userId: req.user.id, role: req.user.role, action: 'CANCEL_ORDER', description: `Cancelled order ${order.orderNumber}: ${reason}`, tableName: 'Order', recordId: order.id });

    res.json({ success: true, data: updated, message: 'Order cancelled' });
  } catch (err) { next(err); }
};

const markServed = async (req, res, next) => {
  try {
    const existing = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ success: false, message: 'Order not found' });
    if (req.user.role === 'WAITER' && existing.waiterId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'You can only mark your own orders as served' });
    }
    if (existing.status === 'SERVED') {
      return res.status(409).json({ success: false, message: 'Order already marked as served' });
    }

    const order = await prisma.order.update({
      where: { id: req.params.id },
      data: { status: 'SERVED' },
      include: { table: true, seat: true },
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
// POST /api/v1/orders/merge
// Body: { sourceTableId, destinationTableId }
// Moves all open (unbilled) orders from source table into destination table.
// If destination has an existing open order per seat, items are appended to it.
// Source table is freed (AVAILABLE) and its seats are unoccupied.
// KDS (kitchen/bar) is notified immediately with updated table info.
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

    // Load both tables
    const [sourceTable, destTable] = await Promise.all([
      prisma.restaurantTable.findUnique({ where: { id: sourceTableId }, include: { seats: true } }),
      prisma.restaurantTable.findUnique({ where: { id: destinationTableId }, include: { seats: true } }),
    ]);
    if (!sourceTable) return res.status(404).json({ success: false, message: 'Source table not found' });
    if (!destTable) return res.status(404).json({ success: false, message: 'Destination table not found' });

    // Find all open (not cancelled, not fully paid) orders on source table
    const sourceOrders = await prisma.order.findMany({
      where: {
        tableId: sourceTableId,
        status: { notIn: ['CANCELLED'] },
        OR: [
          { bill: { is: null } },
          { bill: { status: { not: 'PAID' } } },
        ],
      },
      include: {
        items: true,
        kitchenOrder: true,
        barOrder: true,
        seat: true,
      },
    });

    if (sourceOrders.length === 0) {
      return res.status(400).json({ success: false, message: 'No open orders found on source table' });
    }

    // For each source order, move its items to the destination table.
    // Strategy: reassign the order's tableId to destination, and reassign seatId
    // to a matching seat on destination (by seat index). If destination has fewer
    // seats, overflow items all go to the first available seat on destination.
    const destSeats = destTable.seats;
    if (destSeats.length === 0) {
      return res.status(400).json({ success: false, message: 'Destination table has no seats' });
    }

    const mergedOrderIds = [];

    for (const srcOrder of sourceOrders) {
      // Find matching seat on destination by position in seats array,
      // fall back to first seat if source seat index exceeds dest seat count.
      const srcSeatIndex = sourceTable.seats.findIndex(s => s.id === srcOrder.seatId);
      const destSeat = destSeats[srcSeatIndex] ?? destSeats[0];

      // Reassign order to destination table/seat
      await prisma.order.update({
        where: { id: srcOrder.id },
        data: {
          tableId: destinationTableId,
          seatId: destSeat.id,
        },
      });

      // Mark destination seat as occupied
      await prisma.seat.update({ where: { id: destSeat.id }, data: { isOccupied: true } });

      mergedOrderIds.push(srcOrder.id);

      // Notify KDS (kitchen + bar) that this order's table has changed
      // so screens update immediately for any in-progress items.
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

    // Free source table and all its seats
    await prisma.restaurantTable.update({
      where: { id: sourceTableId },
      data: { status: 'AVAILABLE' },
    });
    await prisma.seat.updateMany({
      where: { tableId: sourceTableId },
      data: { isOccupied: false },
    });

    // Mark destination table as OCCUPIED
    await prisma.restaurantTable.update({
      where: { id: destinationTableId },
      data: { status: 'OCCUPIED' },
    });

    // Fetch merged orders with full data for response
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

    // Notify all roles of the merge
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

module.exports = { getOrders, getOrderById, createOrder, cancelOrder, markServed, requestBill, mergeTables };