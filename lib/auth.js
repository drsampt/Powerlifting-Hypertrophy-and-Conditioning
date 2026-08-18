// Account authentication: password hashing (scrypt, no extra dependency) and
// bearer-token sessions, so each athlete's profiles/programs are isolated to their
// own account.

const crypto = require('crypto');
const { query } = require('./db');

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, salt, hash) {
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(check, 'hex'), Buffer.from(hash, 'hex'));
}

async function createAccount(email, password, name) {
  const { hash, salt } = hashPassword(password);
  const { rows } = await query(
    'INSERT INTO tpb_accounts (email, password_hash, password_salt, name) VALUES ($1, $2, $3, $4) RETURNING id, email, name',
    [email.toLowerCase().trim(), hash, salt, name || null]
  );
  return rows[0];
}

async function findAccountByEmail(email) {
  const { rows } = await query('SELECT * FROM tpb_accounts WHERE email = $1', [email.toLowerCase().trim()]);
  return rows[0] || null;
}

async function createSessionToken(accountId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await query('INSERT INTO tpb_auth_tokens (token, account_id, expires_at) VALUES ($1, $2, $3)', [token, accountId, expiresAt]);
  return token;
}

async function accountForToken(token) {
  const { rows } = await query(
    `SELECT a.id, a.email, a.name FROM tpb_auth_tokens t
     JOIN tpb_accounts a ON a.id = t.account_id
     WHERE t.token = $1 AND t.expires_at > now()`,
    [token]
  );
  return rows[0] || null;
}

async function deleteToken(token) {
  await query('DELETE FROM tpb_auth_tokens WHERE token = $1', [token]);
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required.' });
  accountForToken(token)
    .then(account => {
      if (!account) return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
      req.account = account;
      req.authToken = token;
      next();
    })
    .catch(next);
}

module.exports = { hashPassword, verifyPassword, createAccount, findAccountByEmail, createSessionToken, accountForToken, deleteToken, requireAuth };
