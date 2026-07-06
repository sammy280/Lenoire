const jwt = require('jsonwebtoken');
const prisma = require('../config/database');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }

    // Check session
    const session = await prisma.session.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!session || session.expiresAt < new Date()) {
      return res.status(401).json({ success: false, message: 'Session expired' });
    }

    if (!session.user.isActive) {
      return res.status(403).json({ success: false, message: 'Account deactivated' });
    }

    if (session.user.lockedUntil && session.user.lockedUntil > new Date()) {
      return res.status(423).json({ success: false, message: 'Account temporarily locked' });
    }

    req.user = session.user;
    req.token = token;
    next();
  } catch (err) {
    next(err);
  }
};

// IT is a super-admin role: it passes every authorize() check regardless of
// which roles were listed, so it automatically has unrestricted access to
// every route in the system without needing IT added to each route's role list.
const authorize = (...roles) => (req, res, next) => {
  if (req.user.role === 'IT') {
    return next();
  }
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }
  next();
};

module.exports = { authenticate, authorize };