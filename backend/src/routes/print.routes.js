const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const prisma = require('../config/database');

router.use(authenticate);

// Create print job
router.post('/', async (req, res, next) => {
  try {
    const { jobType, title, content, targetPrinter, orderId, billId } = req.body;
    const job = await prisma.printLog.create({
      data: { jobType, title, content: typeof content === 'object' ? JSON.stringify(content) : content, targetPrinter, orderId, billId, printedById: req.user.id },
    });
    // Emit via socket so printer client can receive it
    const io = req.app.get('io');
    io?.to(`printer:${targetPrinter}`).emit('print:job', { ...job, content: JSON.parse(typeof job.content === 'string' ? job.content : JSON.stringify(job.content)) });
    res.status(201).json({ success: true, data: job });
  } catch (err) { next(err); }
});

// Mark printed
router.patch('/:id/printed', async (req, res, next) => {
  try {
    const job = await prisma.printLog.update({ where: { id: req.params.id }, data: { status: 'PRINTED', printedAt: new Date() } });
    res.json({ success: true, data: job });
  } catch (err) { next(err); }
});

// Mark failed
router.patch('/:id/failed', async (req, res, next) => {
  try {
    const job = await prisma.printLog.update({ where: { id: req.params.id }, data: { status: 'FAILED' } });
    res.json({ success: true, data: job });
  } catch (err) { next(err); }
});

// Get pending print jobs for a printer
router.get('/pending/:printer', async (req, res, next) => {
  try {
    const jobs = await prisma.printLog.findMany({
      where: { targetPrinter: req.params.printer, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ success: true, data: jobs });
  } catch (err) { next(err); }
});

// Get print log history
router.get('/history', async (req, res, next) => {
  try {
    const { printer, from, to, jobType } = req.query;
    const where = {};
    if (printer) where.targetPrinter = printer;
    if (jobType) where.jobType = jobType;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }
    const logs = await prisma.printLog.findMany({
      where,
      include: { printedBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ success: true, data: logs });
  } catch (err) { next(err); }
});

module.exports = router;
