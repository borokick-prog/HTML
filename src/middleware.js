const { getSetting } = require('./db');

function requireSetup(req, res, next) {
  const configured = !!getSetting('admin_password_hash');
  if (req.path === '/setup') {
    if (configured) return res.redirect('/login');
    return next();
  }
  if (!configured) return res.redirect('/setup');
  next();
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.redirect('/login');
}

module.exports = { requireSetup, requireAdmin };
