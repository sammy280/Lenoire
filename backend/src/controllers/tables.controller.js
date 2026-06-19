const prisma = require('../config/database');

const getTables = async (req, res, next) => {
  try {
    const tables = await prisma.restaurantTable.findMany({
      include: {
        seats: true,
        orders: { where: { status: { notIn: ['CANCELLED'] } }, include: { bill: true }, orderBy: { createdAt: 'desc' }, take: 1 },
        reservations: { where: { status: { in: ['CONFIRMED', 'PENDING'] }, reservationDate: { gte: new Date() } } },
      },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: tables });
  } catch (err) { next(err); }
};

const createTable = async (req, res, next) => {
  try {
    const { name, seatCount } = req.body;
    const table = await prisma.restaurantTable.create({
      data: {
        name,
        seats: {
          create: Array.from({ length: seatCount }, (_, i) => ({ label: `${name}${i + 1}` })),
        },
      },
      include: { seats: true },
    });
    res.status(201).json({ success: true, data: table });
  } catch (err) { next(err); }
};

const updateTableStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const table = await prisma.restaurantTable.update({ where: { id: req.params.id }, data: { status } });
    const io = req.app.get('io');
    io.emit('table:updated', table);
    res.json({ success: true, data: table });
  } catch (err) { next(err); }
};

const getTableDetail = async (req, res, next) => {
  try {
    const table = await prisma.restaurantTable.findUnique({
      where: { id: req.params.id },
      include: {
        seats: {
          include: {
            orders: {
              where: { status: { notIn: ['CANCELLED'] } },
              include: {
                items: { include: { product: true } },
                waiter: { select: { id: true, name: true } },
                kitchenOrder: true,
                barOrder: true,
                bill: { include: { payment: true } },
              },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });
    if (!table) return res.status(404).json({ success: false, message: 'Table not found' });
    res.json({ success: true, data: table });
  } catch (err) { next(err); }
};

const updateTable = async (req, res, next) => {
  try {
    const { name, seatCount } = req.body;
    const existing = await prisma.restaurantTable.findUnique({ where: { id: req.params.id }, include: { seats: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Table not found' });

    const updates = {};
    if (name && name !== existing.name) updates.name = name;

    // Handle seat count change
    if (seatCount !== undefined) {
      const currentCount = existing.seats.length;
      if (seatCount > currentCount) {
        // Add more seats
        const newSeats = Array.from({ length: seatCount - currentCount }, (_, i) => ({
          label: `${updates.name || existing.name}${currentCount + i + 1}`,
        }));
        updates.seats = { create: newSeats };
      } else if (seatCount < currentCount) {
        // Remove excess unoccupied seats (from the end)
        const toRemove = existing.seats.filter(s => !s.isOccupied).slice(-(currentCount - seatCount));
        if (toRemove.length < currentCount - seatCount) {
          return res.status(400).json({ success: false, message: 'Cannot remove occupied seats' });
        }
        await prisma.seat.deleteMany({ where: { id: { in: toRemove.map(s => s.id) } } });
      }
    }

    const table = await prisma.restaurantTable.update({
      where: { id: req.params.id },
      data: updates,
      include: { seats: true },
    });
    const io = req.app.get('io');
    io?.emit('table:updated', table);
    res.json({ success: true, data: table });
  } catch (err) { next(err); }
};

const deleteTable = async (req, res, next) => {
  try {
    const table = await prisma.restaurantTable.findUnique({ where: { id: req.params.id }, include: { seats: true, orders: { where: { status: { notIn: ['CANCELLED'] } } } } });
    if (!table) return res.status(404).json({ success: false, message: 'Table not found' });
    if (table.orders.length > 0) return res.status(400).json({ success: false, message: 'Cannot delete table with active orders' });
    if (table.seats.some(s => s.isOccupied)) return res.status(400).json({ success: false, message: 'Cannot delete table with occupied seats' });
    await prisma.seat.deleteMany({ where: { tableId: req.params.id } });
    await prisma.restaurantTable.delete({ where: { id: req.params.id } });
    const io = req.app.get('io');
    io?.emit('table:deleted', { id: req.params.id });
    res.json({ success: true, message: 'Table deleted' });
  } catch (err) { next(err); }
};

const addSeat = async (req, res, next) => {
  try {
    const table = await prisma.restaurantTable.findUnique({ where: { id: req.params.id }, include: { seats: true } });
    if (!table) return res.status(404).json({ success: false, message: 'Table not found' });
    const label = req.body.label || `${table.name}${table.seats.length + 1}`;
    const seat = await prisma.seat.create({ data: { tableId: req.params.id, label } });
    res.status(201).json({ success: true, data: seat });
  } catch (err) { next(err); }
};

const removeSeat = async (req, res, next) => {
  try {
    const seat = await prisma.seat.findUnique({ where: { id: req.params.seatId } });
    if (!seat) return res.status(404).json({ success: false, message: 'Seat not found' });
    if (seat.isOccupied) return res.status(400).json({ success: false, message: 'Cannot remove occupied seat' });
    await prisma.seat.delete({ where: { id: req.params.seatId } });
    res.json({ success: true, message: 'Seat removed' });
  } catch (err) { next(err); }
};

module.exports = { getTables, createTable, updateTable, deleteTable, addSeat, removeSeat, updateTableStatus, getTableDetail };
