/** Backend-only HTTP helper. See ../iews-telegram-verification.md for mandatory IEWS account/session binding. */
function config() {
  const base = String(process.env.IEWS_GK_VERIFY_BASE || 'https://ecom.ggmt.sg/30da/hub/verify/telegram').replace(/\/+$/, '');
  const u = new URL(base);
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) throw new Error('IEWS_GK_VERIFY_BASE must be a clean HTTPS URL.');
  const token = process.env.IEWS_GK_VERIFY_TOKEN;
  if (!/^verifyiews_[A-Za-z0-9_-]{43}$/.test(token || '')) throw new Error('Configure IEWS_GK_VERIFY_TOKEN in server secrets.');
  return { base, token };
}

async function call(method, path, data) {
  const { base, token } = config();
  const response = await fetch(base + path, {
    method, redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${token}`, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify(data || {}) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.message || 'GKVerify request failed'), { status: response.status, code: result.error });
  return result;
}

function requestPath(id) {
  if (!/^[a-f0-9]{64}$/.test(id || '')) throw new Error('Invalid GKVerify request ID.');
  return `/requests/${id}`;
}

export const startPhoneCheck = ({ phone, reference }) => call('POST', '/requests', { phone, reference });
export const phoneCheckStatus = id => call('GET', requestPath(id));
export const collectPhoneCheck = id => call('POST', `${requestPath(id)}/consume`, {});
