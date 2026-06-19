const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const prisma = require('../config/database');
const { createNotification } = require('../services/notification.service');
const { createAuditLog } = require('../middleware/audit');

router.use(authenticate, authorize('ADMIN', 'MANAGER'));

// Get salary history for all employees or specific one
router.get('/history', async (req, res, next) => {
  try {
    const { employeeId } = req.query;
    const where = employeeId ? { employeeId } : {};
    const history = await prisma.salaryHistory.findMany({
      where,
      include: { employee: { select: { id: true, name: true, role: true } } },
      orderBy: { changedAt: 'desc' },
    });
    res.json({ success: true, data: history });
  } catch (err) { next(err); }
});

// Update base salary (with history record)
router.patch('/base/:userId', async (req, res, next) => {
  try {
    const { baseSalary, reason } = req.body;
    if (!baseSalary || !reason) return res.status(400).json({ success: false, message: 'baseSalary and reason required' });

    const profile = await prisma.employeeProfile.findUnique({ where: { userId: req.params.userId } });
    if (!profile) return res.status(404).json({ success: false, message: 'Employee profile not found' });

    const oldSalary = parseFloat(profile.baseSalary || 0);
    const newSalary = parseFloat(baseSalary);

    // Update base salary
    await prisma.employeeProfile.update({
      where: { userId: req.params.userId },
      data: { baseSalary: newSalary },
    });

    // Record history
    const user = await prisma.user.findUnique({ where: { id: req.params.userId }, select: { id: true, name: true } });
    await prisma.salaryHistory.create({
      data: {
        employeeId: req.params.userId,
        oldSalary,
        newSalary,
        reason,
        changedById: req.user.id,
        changedBy: req.user.name,
      },
    });

    await createAuditLog({
      userId: req.user.id, role: req.user.role, action: 'UPDATE_BASE_SALARY',
      description: `Base salary updated for ${user?.name}: ${oldSalary} → ${newSalary} RWF. Reason: ${reason}`,
      tableName: 'EmployeeProfile', recordId: profile.id,
      oldValues: { baseSalary: oldSalary },
      newValues: { baseSalary: newSalary },
    });

    res.json({ success: true, message: 'Salary updated', oldSalary, newSalary });
  } catch (err) { next(err); }
});

// List salary advances
router.get('/advances', async (req, res, next) => {
  try {
    const { employeeId, status, period } = req.query;
    const where = {};
    if (employeeId) where.employeeId = employeeId;
    if (status) where.status = status;
    if (period) where.period = period;
    const advances = await prisma.salaryAdvance.findMany({
      where,
      include: {
        employee: { select: { id: true, name: true, role: true } },
        approvedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: advances });
  } catch (err) { next(err); }
});

// Create salary advance request
router.post('/advances', async (req, res, next) => {
  try {
    const { employeeId, amount, period, reason } = req.body;
    const advance = await prisma.salaryAdvance.create({
      data: { employeeId, amount: parseFloat(amount), period, reason, status: 'APPROVED', approvedById: req.user.id, approvedAt: new Date() },
      include: { employee: { select: { id: true, name: true } } },
    });
    await createAuditLog({
      userId: req.user.id, role: req.user.role, action: 'SALARY_ADVANCE',
      description: `Salary advance of ${amount} RWF recorded for ${advance.employee.name} — period ${period}`,
      tableName: 'SalaryAdvance', recordId: advance.id,
    });
    res.status(201).json({ success: true, data: advance });
  } catch (err) { next(err); }
});

// Get advances for a specific period (used in auto-payroll)
router.get('/advances/period/:period', async (req, res, next) => {
  try {
    const advances = await prisma.salaryAdvance.findMany({
      where: { period: req.params.period, status: 'APPROVED' },
      include: { employee: { select: { id: true, name: true } } },
    });
    // Sum by employee
    const byEmployee = {};
    advances.forEach(a => {
      byEmployee[a.employeeId] = (byEmployee[a.employeeId] || 0) + parseFloat(a.amount);
    });
    res.json({ success: true, data: advances, byEmployee });
  } catch (err) { next(err); }
});

module.exports = router;
