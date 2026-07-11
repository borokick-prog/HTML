const crypto = require('crypto');

const KEY_LENGTH = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const hashBuffer = Buffer.from(hash, 'hex');
  const candidate = crypto.scryptSync(password, salt, KEY_LENGTH);
  if (candidate.length !== hashBuffer.length) return false;
  return crypto.timingSafeEqual(candidate, hashBuffer);
}

module.exports = { hashPassword, verifyPassword };
