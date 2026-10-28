/** Shared Telegram phone checks. IEWS owns its users; this API never signs into 30+DA.
 * Server-to-server only. See docs/iews-telegram-verification.md for the integration contract.
 */
import crypto from 'node:crypto';
import { SETTINGS_COLLECTION, makeToken, removeToken, tokenStatus, checkToken } from './thirtyda-settings.mjs';
import { TG_CHECKS, CHECK_TTL_MS, CHECK_KEEP_MS, botOffered, botConfig, startLink, checkId, newMatchMark, windowLimiter } from './thirtyda-telegram-bot.mjs';

export const VERIFY_BASE = '/30da/hub/verify/telegram';
const APP = 'iews';
const TOKEN_SETTING = 'verify_iews';
const OPTIONS = 'verify_iews_options';
const limits = windowLimiter();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
const iso = value => value ? new Date(value).toISOString() : null;

export async function verificationAdminView(d) {
  const options = await d.collection(SETTINGS_COLLECTION).findOne({ _id: OPTIONS });
  const token = await tokenStatus(d, TOKEN_SETTING);
  const ready = await botOffered(d);
  const stats = await d.collection(TG_CHECKS).aggregate([
    { $match: { hubApp: APP } }, { $group: { _id: '$state', count: { $sum: 1 } } },
  ]).toArray();
  return { app: APP, name: 'IEWS', base: VERIFY_BASE, token, returnUrl: options?.returnUrl || '',
    ready: Boolean(ready && token.set && options?.returnUrl),
    // Short-lived checks only, not lifetime traffic counts.
    recent: Object.fromEntries(stats.map(s => [s._id, s.count])) };
}

export async function verificationAdminAction(d, method, input) {
  if (method === 'POST') return makeToken(d, TOKEN_SETTING, { by: 'superadmin' });
  if (method === 'DELETE') return removeToken(d, TOKEN_SETTING);
  if (method !== 'PUT') throw fail(405, 'method_not_allowed', 'Use PUT, POST or DELETE.');
  let u;
  try { u = new URL(input.returnUrl); } catch { throw fail(422, 'invalid', 'Enter the IEWS HTTPS page to return to.'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.href.length > 500 || u.search || u.hash) {
    throw fail(422, 'invalid', 'Use an HTTPS return page without a query, fragment or embedded credentials.');
  }
  await d.collection(SETTINGS_COLLECTION).updateOne({ _id: OPTIONS }, {
    $set: { returnUrl: u.href, updatedAt: new Date(), updatedBy: 'superadmin' },
  }, { upsert: true });
  return { ok: true };
}

async function body(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) {
    req.resume(); throw fail(415, 'json_required', 'Send application/json.');
  }
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) throw fail(413, 'too_large', 'JSON body must be at most 4096 bytes.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw fail(400, 'invalid_json', 'Send a JSON object.'); }
}

async function start(d, input, auth, plain, now) {
  const phone = typeof input.phone === 'string' ? input.phone : '';
  const reference = typeof input.reference === 'string' ? input.reference : '';
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw fail(422, 'invalid_phone', 'Use E.164 format, for example +85512345678.');
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(reference)) throw fail(422, 'invalid_reference', 'Use a random 16–100 character reference, such as a UUID.');
  if (!await botOffered(d)) throw fail(503, 'bot_unavailable', 'Telegram verification is not enabled.');
  const cfg = await botConfig(d);
  const options = await d.collection(SETTINGS_COLLECTION).findOne({ _id: OPTIONS });
  if (!cfg || !options?.returnUrl) throw fail(503, 'setup_required', 'Configure the IEWS return page in the Telegram Bot tower.');
  // Reconstruct the same deep link for network retries without storing the link token.
  const token = crypto.createHmac('sha256', plain).update(`telegram:${reference}`).digest('base64url').slice(0, 32);
  const id = checkId(token);
  const checks = d.collection(TG_CHECKS);
  let check = await checks.findOne({ _id: id, hubApp: APP, hubGeneration: auth.hash });
  if (check && (check.phone !== phone || new Date(check.expires).getTime() <= now)) {
    throw fail(409, 'reference_conflict', 'This reference was used for another number or has expired. Start with a new reference.');
  }
  if (!check) {
    if (limits.over(`start:${auth.hash}`, 100, now) || limits.over(`phone:${hash(phone)}`, 5, now)) {
      throw fail(429, 'rate_limited', 'Too many checks. Try again in 15 minutes.');
    }
    check = { _id: id, hubApp: APP, hubGeneration: auth.hash, hubReference: reference,
      hubReturnUrl: options.returnUrl, hubName: 'IEWS', phone, lang: 'en', match: newMatchMark(), state: 'waiting',
      created: new Date(now), expires: new Date(now + CHECK_TTL_MS), purgeAt: new Date(now + CHECK_TTL_MS + CHECK_KEEP_MS) };
    try { await checks.insertOne(check); }
    catch (err) {
      if (err.code !== 11000) throw err;
      check = await checks.findOne({ _id: id, hubApp: APP, hubGeneration: auth.hash });
      if (!check || check.phone !== phone) throw fail(409, 'reference_conflict', 'Reference already used.');
    }
  }
  return { request_id: id, reference, status: status(check, now), telegram_url: startLink(cfg.username, token),
    match: check.match, expires_at: iso(check.expires), poll_after_ms: 2000 };
}

const status = (check, now) => new Date(check.expires).getTime() <= now ? 'expired'
  : check.state === 'used' ? 'consumed' : check.state;

export async function verificationRequest(d, method, path, input, plain, now = Date.now()) {
  const auth = await checkToken(d, TOKEN_SETTING, plain);
  if (!auth) throw fail(401, 'unauthorized', 'Use the current IEWS verification key.');
  if (limits.over(`requests:${auth.hash}`, 12000, now)) throw fail(429, 'rate_limited', 'Too many requests.');
  if (path === '/requests' && method === 'POST') return start(d, input, auth, plain, now);
  const m = path.match(/^\/requests\/([a-f0-9]{64})(\/consume)?$/);
  if (!m) throw fail(404, 'not_found', 'No such verification endpoint.');
  if ((!m[2] && method !== 'GET') || (m[2] && method !== 'POST')) throw fail(405, 'method_not_allowed', 'Use GET for status or POST to consume.');
  const col = d.collection(TG_CHECKS);
  const mine = { _id: m[1], hubApp: APP, hubGeneration: auth.hash };
  let check = await col.findOne(mine);
  if (!check) throw fail(404, 'not_found', 'No check belonging to this application key.');
  if (m[2]) {
    if (status(check, now) === 'expired') throw fail(410, 'expired', 'The check expired. Start a new check.');
    if (!['verified', 'used'].includes(check.state)) throw fail(409, 'not_verified', 'The number has not been verified.');
    if (check.state === 'verified') {
      await col.updateOne({ ...mine, state: 'verified', expires: { $gt: new Date(now) } }, {
        $set: { state: 'used', usedAt: new Date(now) },
      });
      check = await col.findOne(mine);
      if (!check || check.state !== 'used' || status(check, now) === 'expired') throw fail(409, 'not_verified', 'Verification could not be collected.');
    }
    // Idempotent for this application key until expiry: a lost response can be retried safely.
    return { request_id: check._id, reference: check.hubReference, status: 'consumed', app: APP,
      phone: check.phone, verified_at: iso(check.verifiedAt), consumed_at: iso(check.usedAt) };
  }
  return { request_id: check._id, reference: check.hubReference, status: status(check, now),
    expires_at: iso(check.expires), ...(check.verifiedAt ? { verified_at: iso(check.verifiedAt) } : {}) };
}

let indexed;
export async function handleVerification(req, res, path) {
  const reply = (code, value) => res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(code === 401 ? { 'WWW-Authenticate': 'Bearer' } : {}) }).end(JSON.stringify(value));
  try {
    // Credentials are backend-only; no browser/CORS integration is supported.
    if (req.headers.origin) { req.resume(); return reply(403, { error: 'server_only', message: 'Call from your backend.' }); }
    const plain = String(req.headers.authorization || '').match(/^Bearer (\S+)$/)?.[1];
    if (!plain?.startsWith('verifyiews_') || plain.length !== 54) {
      req.resume(); return reply(401, { error: 'unauthorized', message: 'Use the IEWS verification key.' });
    }
    const d = await (await import('./mongo.ts')).getDb();
    const auth = await checkToken(d, TOKEN_SETTING, plain);
    if (!auth) { req.resume(); return reply(401, { error: 'unauthorized', message: 'Use the current IEWS verification key.' }); }
    indexed ??= d.collection(TG_CHECKS).createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 }).catch(err => { indexed = null; throw err; });
    await indexed;
    const input = req.method === 'POST' ? await body(req) : {};
    if (req.method !== 'POST') req.resume();
    const result = await verificationRequest(d, req.method, path.slice(VERIFY_BASE.length), input, plain);
    return reply(path === `${VERIFY_BASE}/requests` ? 201 : 200, result);
  } catch (err) {
    if (!err.status) console.error('[hub verify] Request failed:', err.name || 'Error');
    if (!res.headersSent) reply(err.status || 503, { error: err.code && err.status ? err.code : 'unavailable',
      message: err.status ? err.message : 'Verification is temporarily unavailable.' });
  }
}
