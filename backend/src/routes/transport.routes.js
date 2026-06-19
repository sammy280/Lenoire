const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const prisma = require('../config/database');
const { createAuditLog } = require('../middleware/audit');

router.use(authenticate);

// List transport allowances
router.get('/', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const { employeeId, from, to } = req.query;
    const where = {};
    if (employeeId) where.employeeId = employeeId;
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }
    const allowances = await prisma.transportAllowance.findMany({
      where,
      include: {
        employee: { select: { id: true, name: true, role: true } },
        recordedBy: { select: { id: true, name: true } },
      },
      orderBy: { date: 'desc' },
    });

    // Summary totals
    const total = allowances.reduce((s, a) => s + parseFloat(a.amount), 0);
    res.json({ success: true, data: allowances, total });
  } catch (err) { next(err); }
});

// My own transport allowances
router.get('/my', async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const where = { employeeId: req.user.id };
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }
    const allowances = await prisma.transportAllowance.findMany({ where, orderBy: { date: 'desc' } });
    const total = allowances.reduce((s, a) => s + parseFloat(a.amount), 0);
    res.json({ success: true, data: allowances, total });
  } catch (err) { next(err); }
});

// Record transport allowance
router.post('/', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const { employeeId, amount, date, notes } = req.body;
    const allowance = await prisma.transportAllowance.create({
      data: {
        employeeId,
        amount: parseFloat(amount),
        date: date ? new Date(date) : new Date(),
        notes,
        recordedById: req.user.id,
      },
      include: { employee: { select: { id: true, name: true } } },
    });
    await createAuditLog({
      userId: req.user.id, role: req.user.role, action: 'RECORD_TRANSPORT',
      description: `Transport allowance recorded for ${allowance.employee.name}: ${amount} RWF`,
      tableName: 'TransportAllowance', recordId: allowance.id,
    });
    res.status(201).json({ success: true, data: allowance });
  } catch (err) { next(err); }
});

// Bulk record (multiple employees same day)
router.post('/bulk', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const { entries, date } = req.body; // [{employeeId, amount, notes}]
    const d = date ? new Date(date) : new Date();
    const records = await prisma.$transaction(
      entries.map(e => prisma.transportAllowance.create({
        data: { employeeId: e.employeeId, amount: parseFloat(e.amount), date: d, notes: e.notes, recordedById: req.user.id },
      }))
    );
    res.status(201).json({ success: true, data: records, message: `${records.length} transport allowances recorded` });
  } catch (err) { next(err); }
});

// Delete
router.delete('/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    await prisma.transportAllowance.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Deleted' });
  } catch (err) { next(err); }
});

// Monthly report
router.get('/report', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const { month } = req.query; // "2026-06"
    if (!month) return res.status(400).json({ success: false, message: 'month required (YYYY-MM)' });
    const [y, m] = month.split('-').map(Number);
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 1);

    const allowances = await prisma.transportAllowance.findMany({
      where: { date: { gte: start, lt: end } },
      include: { employee: { select: { id: true, name: true, role: true } } },
    });

    // Group by employee
    const byEmployee = {};
    allowances.forEach(a => {
      if (!byEmployee[a.employeeId]) {
        byEmployee[a.employeeId] = { employee: a.employee, days: 0, total: 0 };
      }
      byEmployee[a.employeeId].days++;
      byEmployee[a.employeeId].total += parseFloat(a.amount);
    });

    const grandTotal = allowances.reduce((s, a) => s + parseFloat(a.amount), 0);
    res.json({ success: true, data: Object.values(byEmployee), grandTotal, month });
  } catch (err) { next(err); }
});

module.exports = router;
