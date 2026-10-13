/**
 * 30+DA test-only stand-in for the outside world — the dev server + the e2e, never production.
 *
 * ON only when ALL of these hold (testFetchAllowed):
 *   THIRTYDA_TEST_FETCH=1, MONGO_DB ends with "_dev", and the process is not on Railway (no RAILWAY_ENVIRONMENT /
 *   RAILWAY_PROJECT_ID / RAILWAY_SERVICE_ID).
 * Otherwise outboundFetch() is the plain global fetch and nothing here runs.
 *
 * When ON, a request to one of the provider addresses below (Google / Facebook sign-in, Telegram Gateway,
 * WhatsApp through graph.facebook.com) is answered from the dev DB collection `thirtyda_test_fetch` IF the e2e
 * left an answer there for it:
 *   { _id: "<METHOD> <origin + path, no query>", reply: { status, json, delayMs?, fail?: 'timeout' | 'network' }, calls: [...] }
 * and the request is noted in `calls` (the last 20) — redacted: a secret, a code or a token only as its last 4,
 * a phone number masked — so the e2e can check its shape. No answer stored → the real fetch, unchanged.
 */

export const TEST_FETCH_COLLECTION = "thirtyda_test_fetch";
const HOSTS = new Set(["oauth2.googleapis.com", "openidconnect.googleapis.com", "graph.facebook.com", "gatewayapi.telegram.org"]);
const SECRET_KEYS = new Set(["client_secret", "code", "access_token", "refresh_token", "id_token"]);

/** The one switch: an explicit flag, a dev database, and not the live server. */
export function testFetchAllowed(env = process.env) {
  return env.THIRTYDA_TEST_FETCH === "1"
    && /_dev$/.test(String(env.MONGO_DB ?? ""))
    && !env.RAILWAY_ENVIRONMENT && !env.RAILWAY_PROJECT_ID && !env.RAILWAY_SERVICE_ID;
}

const last4 = (v) => (v ? `…${String(v).slice(-4)}` : v);
const maskPhone = (p) => String(p ?? "").replace(/\d(?=\d{3})/g, "•");

function redactParams(params) {
  const out = {};
  for (const [k, v] of params) out[k] = SECRET_KEYS.has(k) ? last4(v) : v;
  return out;
}

/** What the e2e may see of one request: never a whole secret, code, token or phone number. */
export function redactCall(url, init = {}) {
  const u = new URL(String(url));
  const headers = {};
  for (const [k, v] of Object.entries(init.headers || {})) {
    headers[k.toLowerCase()] = k.toLowerCase() === "authorization" ? String(v).replace(/^(\w+)\s+(.*)$/, (_, s, t) => `${s} ${last4(t)}`) : v;
  }
  let body = null;
  const raw = typeof init.body === "string" ? init.body : null;
  if (raw) {
    if (String(headers["content-type"] || "").includes("x-www-form-urlencoded")) body = redactParams(new URLSearchParams(raw));
    else {
      try {
        const j = JSON.parse(raw);
        body = { ...j };
        if ("code" in body) body.code = "••••••";
        if ("phone_number" in body) body.phone_number = maskPhone(body.phone_number);
        if ("to" in body) body.to = maskPhone(body.to);
        if (body.template) body.template = { name: body.template.name, language: body.template.language };
      } catch {
        body = { length: raw.length };
      }
    }
  }
  return { at: new Date(), method: String(init.method || "GET").toUpperCase(), url: `${u.origin}${u.pathname}`, query: redactParams(u.searchParams), headers, body };
}

function waitFor(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(signal.reason); }, { once: true });
  });
}

/** A fetch that answers known provider addresses from `thirtyda_test_fetch` when an answer is stored there. */
export function makeTestFetch(dbFn, realFetch = globalThis.fetch) {
  return async function testFetch(url, init = {}) {
    let u;
    try {
      u = new URL(String(url));
    } catch {
      return realFetch(url, init);
    }
    if (!HOSTS.has(u.host)) return realFetch(url, init);
    const key = `${String(init.method || "GET").toUpperCase()} ${u.origin}${u.pathname}`;
    const col = (await dbFn()).collection(TEST_FETCH_COLLECTION);
    const doc = await col.findOne({ _id: key });
    if (!doc?.reply) return realFetch(url, init);
    await col.updateOne({ _id: key }, { $push: { calls: { $each: [redactCall(url, init)], $slice: -20 } } });
    const { status = 200, json = {}, delayMs = 0, fail = null } = doc.reply;
    if (delayMs > 0) await waitFor(Math.min(Number(delayMs) || 0, 15_000), init.signal);
    if (fail === "network") throw new TypeError("fetch failed");
    if (fail === "timeout") {
      await waitFor(60_000, init.signal);
      throw new DOMException("The operation timed out.", "TimeoutError");
    }
    return new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
  };
}

let chosen = null;
/** The fetch the server uses for providers: the test stand-in when testFetchAllowed(), else the real fetch. */
export function outboundFetch() {
  if (chosen) return chosen;
  if (testFetchAllowed()) {
    console.warn("[30da] TEST FETCH ON (dev database only): provider answers may come from thirtyda_test_fetch.");
    // Loaded only here, so the unit tests (plain node) never import the TypeScript Mongo client.
    chosen = makeTestFetch(async () => (await import("./mongo.ts")).getDb());
  } else {
    chosen = (url, init) => globalThis.fetch(url, init);
  }
  return chosen;
}
