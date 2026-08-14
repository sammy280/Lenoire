const express = require('express');
const router = express.Router();
const prisma = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { createNotification } = require('../services/notification.service');
const { createAuditLog } = require('../middleware/audit');

const CAN_MANAGE_SESSION = ['CASHIER', 'MANAGER', 'ADMIN'];

// ── GET /current ─────────────────────────────────────────────────────────
// Returns the currently open session (or null), plus live revenue totals.
// This is what "Today's Revenue" on the dashboards should call.
router.get('/current', authenticate, async (req, res, next) => {
  try {
    const session = await prisma.cashSession.findFirst({
      where: { status: 'OPEN' },
      orderBy: { openedAt: 'desc' },
      include: {
        openedBy: { select: { id: true, name: true } },
      },
    });

    if (!session) {
      return res.json({ success: true, data: null });
    }

    const paidBills = await prisma.bill.findMany({
      where: { cashSessionId: session.id, status: 'PAID' },
      include: { payment: true },
    });

    const totals = summarizeBills(paidBills);

    res.json({ success: true, data: { ...session, ...totals } });
  } catch (err) { next(err); }
});

// ── POST /open ───────────────────────────────────────────────────────────
router.post('/open', authenticate, authorize(...CAN_MANAGE_SESSION), async (req, res, next) => {
  try {
    const { openingCashAmount, openingNote } = req.body;
    const io = req.app.get('io');

    const existing = await prisma.cashSession.findFirst({ where: { status: 'OPEN' } });
    if (existing) {
      return res.status(409).json({ success: false, message: 'A cash session is already open. Close it before opening a new one.' });
    }

    const session = await prisma.cashSession.create({
      data: {
        status: 'OPEN',
        openedById: req.user.id,
        openingCashAmount: openingCashAmount != null ? parseFloat(openingCashAmount) : null,
        openingNote,
      },
      include: { openedBy: { select: { id: true, name: true } } },
    });

    await createNotification({
      userIds: [], // broadcast handled via socket below; add manager/admin ids here if you want targeted alerts
      type: 'SYSTEM',
      title: 'Cash Session Opened',
      message: `${req.user.name} opened the register.`,
      data: { cashSessionId: session.id },
      io,
    }).catch(() => {}); // don't block open if notification target list is empty/misconfigured

    io.emit('cashSession:opened', session);
    await createAuditLog({
      userId: req.user.id,
      role: req.user.role,
      action: 'OPEN_CASH_SESSION',
      description: `Opened cash session${openingCashAmount ? ` with float ${openingCashAmount} RWF` : ''}`,
      tableName: 'CashSession',
      recordId: session.id,
    });

    res.status(201).json({ success: true, data: session });
  } catch (err) { next(err); }
});

// ── POST /:id/close ─────────────────────────────────────────────────────
router.post('/:id/close', authenticate, authorize(...CAN_MANAGE_SESSION), async (req, res, next) => {
  try {
    const { countedCash, closingNote } = req.body;
    const io = req.app.get('io');

    const session = await prisma.cashSession.findUnique({ where: { id: req.params.id } });
    if (!session) return res.status(404).json({ success: false, message: 'Cash session not found' });
    if (session.status === 'CLOSED') return res.status(409).json({ success: false, message: 'Session already closed' });

    const paidBills = await prisma.bill.findMany({
      where: { cashSessionId: session.id, status: 'PAID' },
      include: { payment: true },
    });

    const totals = summarizeBills(paidBills);
    const openingCash = session.openingCashAmount ? parseFloat(session.openingCashAmount) : 0;
    const expectedCash = openingCash + totals.totalCash;

    const hasCount = countedCash !== undefined && countedCash !== null && countedCash !== '';
    const counted = hasCount ? parseFloat(countedCash) : null;
    const variance = hasCount ? counted - expectedCash : null;

    const closed = await prisma.cashSession.update({
      where: { id: session.id },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        closedById: req.user.id,
        closingNote,
        totalRevenue: totals.totalRevenue,
        totalCash: totals.totalCash,
        totalMomo: totals.totalMomo,
        totalCard: totals.totalCard,
        totalCredit: totals.totalCredit,
        billCount: totals.billCount,
        countedCash: counted,
        expectedCash,
        cashVariance: variance,
      },
      include: {
        openedBy: { select: { id: true, name: true } },
        closedBy: { select: { id: true, name: true } },
      },
    });

    io.emit('cashSession:closed', closed);
    await createAuditLog({
      userId: req.user.id,
      role: req.user.role,
      action: 'CLOSE_CASH_SESSION',
      description: `Closed cash session. Revenue: ${totals.totalRevenue.toLocaleString()} RWF across ${totals.billCount} bills.`,
      tableName: 'CashSession',
      recordId: closed.id,
    });

    res.json({ success: true, data: closed });
  } catch (err) { next(err); }
});

// ── GET / ────────────────────────────────────────────────────────────────
// History of past sessions (for manager/admin reporting).
router.get('/', authenticate, authorize('MANAGER', 'ADMIN'), async (req, res, next) => {
  try {
    const { limit = 30 } = req.query;
    const sessions = await prisma.cashSession.findMany({
      orderBy: { openedAt: 'desc' },
      take: parseInt(limit, 10),
      include: {
        openedBy: { select: { id: true, name: true } },
        closedBy: { select: { id: true, name: true } },
      },
    });
    res.json({ success: true, data: sessions });
  } catch (err) { next(err); }
});

// ── GET /:id ─────────────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const session = await prisma.cashSession.findUnique({
      where: { id: req.params.id },
      include: {
        openedBy: { select: { id: true, name: true } },
        closedBy: { select: { id: true, name: true } },
        bills: {
          where: { status: 'PAID' },
          include: { payment: true, order: { include: { table: true } } },
        },
      },
    });
    if (!session) return res.status(404).json({ success: false, message: 'Cash session not found' });
    res.json({ success: true, data: session });
  } catch (err) { next(err); }
});

// ── helper ───────────────────────────────────────────────────────────────
function summarizeBills(bills) {
  const totals = {
    totalRevenue: 0,
    totalCash: 0,
    totalMomo: 0,
    totalCard: 0,
    totalCredit: 0,
    billCount: bills.length,
  };

  for (const bill of bills) {
    const amount = parseFloat(bill.total);
    totals.totalRevenue += amount;

    const method = bill.payment?.method;
    if (method === 'CASH') totals.totalCash += amount;
    else if (method === 'MOBILE_MONEY') totals.totalMomo += amount;
    else if (method === 'CREDIT_CARD' || method === 'DEBIT_CARD') totals.totalCard += amount;
    else if (method === 'CREDIT') totals.totalCredit += amount;
    else if (method === 'MIXED' && bill.payment?.mixedDetails) {
      // mixedDetails expected shape: { cash: number, momo: number, card: number }
      const md = bill.payment.mixedDetails;
      totals.totalCash += parseFloat(md.cash || 0);
      totals.totalMomo += parseFloat(md.momo || 0);
      totals.totalCard += parseFloat(md.card || 0);
    }
  }

  return totals;
}

module.exports = router;