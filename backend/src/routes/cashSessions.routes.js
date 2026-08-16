const express = require('express');
const { randomUUID } = require('crypto');
const router = express.Router();
const prisma = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { createNotification } = require('../services/notification.service');
const { createAuditLog } = require('../middleware/audit');

const CAN_MANAGE_SESSION = ['CASHIER', 'MANAGER', 'ADMIN'];

// Prisma relation names from the current generated Prisma Client
const OPENED_BY = 'User_CashSession_openedByIdToUser';
const CLOSED_BY = 'User_CashSession_closedByIdToUser';

// ── GET /current ─────────────────────────────────────────────────────────
// Returns the currently open session (or null), plus live revenue totals.
// ── GET /current ─────────────────────────────────────────────────────────
// Returns the currently open session (or null), plus live revenue totals
// and order counts scoped to "since this session opened."
router.get('/current', authenticate, async (req, res, next) => {
  try {
    const session = await prisma.cashSession.findFirst({
      where: { status: 'OPEN' },
      orderBy: { openedAt: 'desc' },
      include: {
        User_CashSession_openedByIdToUser: {
          select: { id: true, name: true },
        },
      },
    });

    if (!session) {
      return res.json({
        success: true,
        data: null,
      });
    }

    const [paidBills, ordersToday, activeOrders] = await Promise.all([
      prisma.bill.findMany({
        where: {
          cashSessionId: session.id,
          status: 'PAID',
        },
        include: {
          payment: true,
        },
      }),
      prisma.order.count({
        where: {
          createdAt: { gte: session.openedAt },
          status: { not: 'CANCELLED' },
        },
      }),
      prisma.order.count({
        where: {
          createdAt: { gte: session.openedAt },
          status: { in: ['PENDING', 'PREPARING', 'READY', 'SERVED'] },
        },
      }),
    ]);

    const totals = summarizeBills(paidBills);

    const data = {
      ...session,
      openedBy: session.User_CashSession_openedByIdToUser,
      ...totals,
      ordersToday,
      activeOrders,
    };

    delete data.User_CashSession_openedByIdToUser;

    res.json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /open ───────────────────────────────────────────────────────────
router.post(
  '/open',
  authenticate,
  authorize(...CAN_MANAGE_SESSION),
  async (req, res, next) => {
    try {
      const { openingCashAmount, openingNote } = req.body;
      const io = req.app.get('io');

      const existing = await prisma.cashSession.findFirst({
        where: { status: 'OPEN' },
      });

      if (existing) {
        return res.status(409).json({
          success: false,
          message:
            'A cash session is already open. Close it before opening a new one.',
        });
      }

      const session = await prisma.cashSession.create({
  data: {
    id: randomUUID(),
    status: 'OPEN',
    openedById: req.user.id,
    openingCashAmount:
      openingCashAmount != null
        ? parseFloat(openingCashAmount)
        : null,
    openingNote,
  },
  include: {
    User_CashSession_openedByIdToUser: {
      select: { id: true, name: true },
    },
  },
});

      const data = {
        ...session,
        openedBy: session.User_CashSession_openedByIdToUser,
      };

      delete data.User_CashSession_openedByIdToUser;

      await createNotification({
        userIds: [],
        type: 'SYSTEM',
        title: 'Cash Session Opened',
        message: `${req.user.name} opened the register.`,
        data: { cashSessionId: session.id },
        io,
      }).catch(() => {});

      io.emit('cashSession:opened', data);

      await createAuditLog({
        userId: req.user.id,
        role: req.user.role,
        action: 'OPEN_CASH_SESSION',
        description: `Opened cash session${
          openingCashAmount
            ? ` with float ${openingCashAmount} RWF`
            : ''
        }`,
        tableName: 'CashSession',
        recordId: session.id,
      });

      res.status(201).json({
        success: true,
        data,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /:id/close ─────────────────────────────────────────────────────
router.post(
  '/:id/close',
  authenticate,
  authorize(...CAN_MANAGE_SESSION),
  async (req, res, next) => {
    try {
      const { countedCash, closingNote } = req.body;
      const io = req.app.get('io');

      const session = await prisma.cashSession.findUnique({
        where: { id: req.params.id },
      });

      if (!session) {
        return res.status(404).json({
          success: false,
          message: 'Cash session not found',
        });
      }

      if (session.status === 'CLOSED') {
        return res.status(409).json({
          success: false,
          message: 'Session already closed',
        });
      }

      const paidBills = await prisma.bill.findMany({
        where: {
          cashSessionId: session.id,
          status: 'PAID',
        },
        include: {
          payment: true,
        },
      });

      const totals = summarizeBills(paidBills);

      const openingCash = session.openingCashAmount
        ? parseFloat(session.openingCashAmount)
        : 0;

      const expectedCash = openingCash + totals.totalCash;

      const hasCount =
        countedCash !== undefined &&
        countedCash !== null &&
        countedCash !== '';

      const counted = hasCount
        ? parseFloat(countedCash)
        : null;

      const variance = hasCount
        ? counted - expectedCash
        : null;

      const closed = await prisma.cashSession.update({
        where: { id: req.params.id },
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
          User_CashSession_openedByIdToUser: {
            select: { id: true, name: true },
          },
          User_CashSession_closedByIdToUser: {
            select: { id: true, name: true },
          },
        },
      });

      const data = {
        ...closed,
        openedBy: closed.User_CashSession_openedByIdToUser,
        closedBy: closed.User_CashSession_closedByIdToUser,
      };

      delete data.User_CashSession_openedByIdToUser;
      delete data.User_CashSession_closedByIdToUser;

      io.emit('cashSession:closed', data);

      await createAuditLog({
        userId: req.user.id,
        role: req.user.role,
        action: 'CLOSE_CASH_SESSION',
        description: `Closed cash session. Revenue: ${totals.totalRevenue.toLocaleString()} RWF across ${totals.billCount} bills.`,
        tableName: 'CashSession',
        recordId: closed.id,
      });

      res.json({
        success: true,
        data,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET / ────────────────────────────────────────────────────────────────
// History of past sessions.
router.get(
  '/',
  authenticate,
  authorize('MANAGER', 'ADMIN'),
  async (req, res, next) => {
    try {
      const { limit = 30 } = req.query;

      const sessions = await prisma.cashSession.findMany({
        orderBy: { openedAt: 'desc' },
        take: parseInt(limit, 10),
        include: {
          User_CashSession_openedByIdToUser: {
            select: { id: true, name: true },
          },
          User_CashSession_closedByIdToUser: {
            select: { id: true, name: true },
          },
        },
      });

      const data = sessions.map((session) => {
        const item = {
          ...session,
          openedBy: session.User_CashSession_openedByIdToUser,
          closedBy: session.User_CashSession_closedByIdToUser,
        };

        delete item.User_CashSession_openedByIdToUser;
        delete item.User_CashSession_closedByIdToUser;

        return item;
      });

      res.json({
        success: true,
        data,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /:id ─────────────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const session = await prisma.cashSession.findUnique({
      where: { id: req.params.id },
      include: {
        User_CashSession_openedByIdToUser: {
          select: { id: true, name: true },
        },
        User_CashSession_closedByIdToUser: {
          select: { id: true, name: true },
        },
        Bill: {
          where: { status: 'PAID' },
          include: {
            payment: true,
            order: {
              include: {
                table: true,
              },
            },
          },
        },
      },
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Cash session not found',
      });
    }

    const data = {
      ...session,
      openedBy: session.User_CashSession_openedByIdToUser,
      closedBy: session.User_CashSession_closedByIdToUser,
      bills: session.Bill,
    };

    delete data.User_CashSession_openedByIdToUser;
    delete data.User_CashSession_closedByIdToUser;
    delete data.Bill;

    res.json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
});

// ── Helper ──────────────────────────────────────────────────────────────
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

    if (method === 'CASH') {
      totals.totalCash += amount;
    } else if (method === 'MOBILE_MONEY') {
      totals.totalMomo += amount;
    } else if (
      method === 'CREDIT_CARD' ||
      method === 'DEBIT_CARD'
    ) {
      totals.totalCard += amount;
    } else if (method === 'CREDIT') {
      totals.totalCredit += amount;
    } else if (
      method === 'MIXED' &&
      bill.payment?.mixedDetails
    ) {
      const md = bill.payment.mixedDetails;

      totals.totalCash += parseFloat(md.cash || 0);
      totals.totalMomo += parseFloat(md.momo || 0);
      totals.totalCard += parseFloat(md.card || 0);
    }
  }

  return totals;
}

module.exports = router;