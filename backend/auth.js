// 用户认证：零依赖实现（Node 内置 crypto）。
// - 密码：scrypt + 随机 salt，存 "salt:hash"，timingSafeEqual 比对
// - 令牌：HMAC-SHA256 签名的 "payload.sig"（自包含 JWT 风格，无需 jsonwebtoken）
// - 可选鉴权中间件：有有效 token 用其 user，否则 fallback 到默认用户 1（向后兼容，
//   保证未登录与历史无主数据仍可用，不破坏现有功能）
import crypto from 'node:crypto';

const TOKEN_SECRET = process.env.AUTH_SECRET
  || process.env.JVM_AUTH_SECRET
  || 'dev-insecure-secret-change-me';
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天
export const DEFAULT_USER_ID = 1;

if (process.env.NODE_ENV === 'production' && TOKEN_SECRET === 'dev-insecure-secret-change-me') {
  console.error('FATAL: AUTH_SECRET is not set in production. Using insecure default.');
}

export function ensureAuthSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // 默认用户（id=1）：承接历史无主数据与未登录请求
  const exists = db.prepare('SELECT 1 FROM users WHERE id = ?').get(DEFAULT_USER_ID);
  if (!exists) {
    db.prepare("INSERT INTO users (id, username, password_hash) VALUES (?, '__default__', '')")
      .run(DEFAULT_USER_ID);
  }
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(test, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signToken(userId, { guest = false } = {}) {
  const payload = Buffer.from(JSON.stringify({
    uid: userId,
    guest: !!guest,
    exp: Date.now() + TOKEN_TTL_MS
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expect = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.exp || data.exp < Date.now()) return null;
    return { userId: data.uid, guest: !!data.guest };
  } catch {
    return null;
  }
}

export { signToken, verifyToken };

// 可选鉴权：失败不拦截，fallback 到默认用户，保证向后兼容
export function authOptional(req, _res, next) {
  const header = req.headers?.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const identity = verifyToken(token);
  req.userId = identity?.userId || DEFAULT_USER_ID;
  req.isAuthed = !!identity && !identity.guest;
  req.isGuest = !!identity?.guest;
  next();
}

// 强制鉴权：仅用于"必须登录"的接口（如真实付费下单），未登录返回 401
export function authRequired(req, res, next) {
  const header = req.headers?.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const identity = verifyToken(token);
  if (!identity || identity.guest) {
    return res.status(401).json({ error: '请先登录' });
  }
  req.userId = identity.userId;
  req.isAuthed = true;
  next();
}

export function identityRequired(req, res, next) {
  if (!req.isAuthed && !req.isGuest) {
    return res.status(401).json({ error: '请先初始化访客身份或登录', code: 'identity_required' });
  }
  next();
}
