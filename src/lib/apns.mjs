/**
 * APNs sender — zero dependencies (node:crypto ES256 JWT + node:http2).
 *
 * Env (Railway → web service → Variables):
 *   APNS_KEY_P8   contents of the .p8 auth key (paste with literal \n or real newlines)
 *   APNS_KEY_ID   10-char key id shown when the key was created
 *   APNS_TEAM_ID  Apple team id (defaults to GGMT's 4KX4774V2U)
 *   APNS_TOPIC    bundle id (defaults sg.ggmt.una5aha)
 *
 * Silently no-ops when the key isn't configured — callers never crash.
 */

import crypto from "node:crypto";
import http2 from "node:http2";

const TEAM_ID = process.env.APNS_TEAM_ID || "4KX4774V2U";
const TOPIC = process.env.APNS_TOPIC || "sg.ggmt.una5aha";
const HOST = process.env.APNS_HOST || "https://api.push.apple.com";

let cachedJwt = { token: null, at: 0 };

function apnsJwt() {
  const key = (process.env.APNS_KEY_P8 || "").replace(/\\n/g, "\n");
  const kid = process.env.APNS_KEY_ID || "";
  if (!key || !kid) return null;
  // APNs accepts a JWT for up to an hour; refresh at 45 min.
  if (cachedJwt.token && Date.now() - cachedJwt.at < 45 * 60 * 1000) return cachedJwt.token;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "ES256", kid })}.${b64({ iss: TEAM_ID, iat: Math.floor(Date.now() / 1000) })}`;
  const sig = crypto.sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  cachedJwt = { token: `${unsigned}.${sig}`, at: Date.now() };
  return cachedJwt.token;
}

/** True when a key is configured (used to skip work early). */
export function apnsReady() {
  return Boolean(process.env.APNS_KEY_P8 && process.env.APNS_KEY_ID);
}

/**
 * Send one push. payload: { title, body, url?, badge? }.
 * Resolves { ok, status } — status 410 means the token is dead (unregister it).
 */
export function sendPush(deviceToken, { title, body, url = "", badge } = {}) {
  return new Promise((resolve) => {
    const jwt = apnsJwt();
    if (!jwt) { resolve({ ok: false, status: 0 }); return; }
    const client = http2.connect(HOST);
    client.on("error", () => resolve({ ok: false, status: 0 }));
    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${jwt}`,
      "apns-topic": TOPIC,
      "apns-push-type": "alert",
      "apns-priority": "10",
    });
    let status = 0;
    req.on("response", (h) => { status = h[":status"]; });
    req.setEncoding("utf8");
    req.on("data", () => {});
    req.on("end", () => { client.close(); resolve({ ok: status === 200, status }); });
    req.on("error", () => { client.close(); resolve({ ok: false, status: 0 }); });
    req.end(JSON.stringify({
      aps: { alert: { title, body }, sound: "default", ...(badge != null ? { badge } : {}) },
      ...(url ? { url } : {}),
    }));
  });
}

/** Send to many tokens; returns dead tokens so the caller can prune them. */
export async function sendPushAll(tokens, payload) {
  const dead = [];
  for (const t of tokens) {
    const r = await sendPush(t, payload);
    if (r.status === 410 || r.status === 400) dead.push(t);
  }
  return { dead };
}
