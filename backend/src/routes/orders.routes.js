const router = require('express').Router();
const ctrl = require('../controllers/orders.controller');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/', authorize('ADMIN', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN', 'BAR'), ctrl.getOrders);
router.post('/', authorize('WAITER'), ctrl.createOrder);

// ⚠️ Must be before /:id routes
router.post('/merge', authorize('CASHIER', 'MANAGER', 'ADMIN'), ctrl.mergeTables);

router.get('/:id', authorize('ADMIN', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN', 'BAR'), ctrl.getOrderById);
router.patch('/:id/cancel', authorize('ADMIN', 'MANAGER', 'WAITER'), ctrl.cancelOrder);
router.patch('/:id/served', authorize('WAITER'), ctrl.markServed);
router.post('/:id/request-bill', authorize('WAITER'), ctrl.requestBill);
router.get('/active', authorize('ADMIN', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN', 'BAR'), ctrl.getActiveOrders);
router.get('/history', authorize('ADMIN', 'MANAGER', 'CASHIER'), ctrl.getOrderHistory);

module.exports = router;