'use strict';
// auth.js — password hashing (node crypto scrypt — no bcrypt dep), cookie sessions stored in the
// `sessions` collection, role middleware, and two tiny shared helpers (audit log, notification).

const crypto = require('crypto');
const { User, Session, AuditLog, Notification } = require('./models');

const COOKIE = 'ocms_sid';
const TTL_DAYS = 7;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex'); // #1 best practice: scrypt, Ki salt
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(test, 'hex'), Buffer.from(hash, 'hex')); // #2 timing-safe compare
}

async function createSession(userId, role) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + TTL_DAYS * 86400000);
  await Session.create({ token, userId, role, expiresAt });
  return token;
}

function setCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,  // #3 xss mitigation
    sameSite: 'lax',
    maxAge: TTL_DAYS * 86400000
  });
}

function clearCookie(res) { res.clearCookie(COOKIE); }

// session lookup: cookie token -> sessions doc -> user
async function loadUser(req, res, next) {
  req.user = null;
  const token = req.cookies[COOKIE];
  if (token) {
    const sess = await Session.findOne({ token, expiresAt: { $gt: new Date() } })
      .select('userId role'); // projection: only the fields needed
    if (sess) {
      req.user = await User.findById(sess.userId).select('name email role active');
      if (req.user && !req.user.active) req.user = null;
      req.sessionDoc = sess;
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

// gate by role list, e.g. requireRole('admin') or requireRole('officer','admin')
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.redirect('/login');
    if (!roles.includes(req.user.role)) return res.status(403).send('403 — not allowed for your role');
    next();
  };
}

async function destroySession(req, res) {
  if (req.cookies[COOKIE]) await Session.deleteOne({ token: req.cookies[COOKIE] });
  clearCookie(res);
}

// shared: write an audit_log record
async function audit(actor, action, entity, entityId, meta) {
  await AuditLog.create({
    actorId: actor && actor._id, actorName: actor ? actor.name : 'system',
    action, entity, entityId, meta
  });
}

// shared: push a notification
async function notify(userId, title, body, link) {
  await Notification.create({ userId, title, body, link });
}

module.exports = {
  COOKIE, hashPassword, verifyPassword, createSession, setCookie, clearCookie,
  loadUser, requireAuth, requireRole, destroySession, audit, notify
};
