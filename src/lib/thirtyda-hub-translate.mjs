/**
 * 30+DA · GK API Hub, Tower 13 · Translate on the admin Code page (owner 2026-10-15): where chat lines and written
 * answers are translated (src/lib/thirtyda-translate.mjs). The pick (handover 2026-10-15 §11): Tencent Hy-MT2-1.8B
 * (Apache-2.0, knows Khmer) in LM Studio on the M1, behind https://llm.ggmt.sg (the M1 guard: a bearer token).
 *
 *   The keys (thirtyda_settings 'translate', one sealed box like the other towers; saved through the page's generic
 *   PUT / DELETE /api/connections/translate): url, model, token (secret: its last 4 only), style ('hy-mt' | 'chat').
 *   checkTranslateFields(input, current) → { ok, values } | { ok: false, field, error } (an empty token keeps the saved one)
 *   translateAdminView(d) → the page's `translate` block: where (url's host, model, style, tower / env), On / Off, the
 *     timeout, the app's numbers since the server started (calls, ok, failed, cached, average ms, last ok / error, a
 *     pause after a failure), the last Try, ours (llm.ggmt.sg, on the privacy page) or not. Never the token.
 *   saveTranslateOptions(d, { enabled?, timeoutS? }) → { ok, options } | { ok: false, field, error }
 *   translateTry(d, { text, from, to }) → one line (or `to: 'all'`: into the 4 other languages) through what is saved,
 *     even while Off; the outcome is noted on the card (noteSecretUse, kind 'try'), never the text.
 */
import { SETTINGS_COLLECTION, fieldsStatus, noteSecretUse } from "./thirtyda-settings.mjs";
import {
  LANG_NAMES, STYLES, TRANSLATE_SETTING, TRANSLATE_OPTIONS, TIMEOUT_MIN_S, TIMEOUT_MAX_S, translateConfig, translateOptions,
  translateStats, tryTranslate, resetTranslate, endpointOf, styleOfModel,
} from "./thirtyda-translate.mjs";
import { TRANSLATE_HOST } from "./thirtyda-pages.mjs";

export const TRY_TEXT_MAX = 500;
const MODEL_RE = /^[\w.\-/:@]{1,120}$/;
const LOCAL_RE = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** The tower's boxes → checked values. url: https (http only on this machine); token: empty keeps the saved one. */
export function checkTranslateFields(input = {}, current = null) {
  const rawUrl = String(input?.url ?? "").trim();
  if (!rawUrl) return { ok: false, field: "url", error: "Write the address first, e.g. https://llm.ggmt.sg" };
  let u = null;
  try { u = new URL(rawUrl); } catch { /* below */ }
  if (!u || !(u.protocol === "https:" || (u.protocol === "http:" && LOCAL_RE.test(u.host)))) {
    return { ok: false, field: "url", error: "The address starts with https:// (e.g. https://llm.ggmt.sg)." };
  }
  if (u.username || u.password || u.search || u.hash) {
    return { ok: false, field: "url", error: "Just the address: no name, password or ?… in it. The token goes in its own box." };
  }
  const url = `${u.origin}${u.pathname}`.replace(/\/+$/, "");
  if (url.length > 300) return { ok: false, field: "url", error: "That address is too long." };
  const model = String(input?.model ?? "").trim();
  if (!model) return { ok: false, field: "model", error: "Write the model's name as LM Studio shows it, e.g. hy-mt2-1.8b" };
  if (!MODEL_RE.test(model)) return { ok: false, field: "model", error: "A model name is letters, digits and . - _ / : @ only." };
  let token = String(input?.token ?? "").trim();
  if (!token && current?.token) token = current.token;
  if (!token) return { ok: false, field: "token", error: "Paste the server's token first (the M1 guard's bearer token)." };
  if (/\s/.test(token) || token.length > 500) return { ok: false, field: "token", error: "A token is one word, no spaces." };
  const style = String(input?.style ?? "").trim() || styleOfModel(model);
  if (!STYLES.includes(style)) return { ok: false, field: "style", error: "Pick how the model is asked: Hy-MT or Chat." };
  return { ok: true, values: { url, model, token, style } };
}

const hostOf = (url) => { try { return new URL(url).host; } catch { return null; } };

export async function translateAdminView(d) {
  const [saved, options, c] = await Promise.all([
    fieldsStatus(d, TRANSLATE_SETTING),
    translateOptions(d),
    translateConfig({ d, fresh: true }),
  ]);
  const st = translateStats();
  const lastTry = saved.lastSend?.kind === "try" ? saved.lastSend : null;
  const host = c ? hostOf(c.url) : null;
  // Live: a provider, switched on, and its last word (the app's last call, else the last Try) was good.
  const lastOkAt = Math.max(Date.parse(st.lastOk?.at) || 0, lastTry?.ok ? Date.parse(lastTry.at) || 0 : 0);
  const lastBadAt = Math.max(Date.parse(st.lastError?.at) || 0, lastTry && !lastTry.ok ? Date.parse(lastTry.at) || 0 : 0);
  let status = "not_set";
  if (c && !c.enabled) status = "off";
  else if (c && (st.pausedUntil || lastBadAt > lastOkAt)) status = "failing";
  else if (c && lastOkAt) status = "live";
  else if (c) status = "saved";
  return {
    id: TRANSLATE_SETTING,
    status,
    // What the tower's Save stored (the plain boxes, the token's last 4), or nothing.
    ...saved,
    source: c?.source ?? null,
    host,
    model: c?.model ?? null,
    style: c?.style ?? null,
    ours: host === TRANSLATE_HOST,
    privacyHost: TRANSLATE_HOST,
    // enabled: what the app does now (a tower never switched on is off; the env's is on).
    options: { ...options, enabled: Boolean(c?.enabled) },
    timeoutRange: [TIMEOUT_MIN_S, TIMEOUT_MAX_S],
    stats: st,
    lastTry,
    langs: Object.keys(LANG_NAMES),
  };
}

export async function saveTranslateOptions(d, input, { by = "superadmin" } = {}) {
  const v = input && typeof input === "object" ? input : {};
  const cur = await translateOptions(d);
  const next = { _id: TRANSLATE_OPTIONS, kind: "options", timeoutS: cur.timeoutS };
  if (typeof cur.enabled === "boolean") next.enabled = cur.enabled;
  if ("enabled" in v) {
    if (typeof v.enabled !== "boolean") return { ok: false, field: "enabled", error: "On or Off." };
    next.enabled = v.enabled;
  }
  if ("timeoutS" in v) {
    const n = v.timeoutS;
    if (!Number.isInteger(n) || n < TIMEOUT_MIN_S || n > TIMEOUT_MAX_S) {
      return { ok: false, field: "timeoutS", error: `The wait is a whole number of seconds from ${TIMEOUT_MIN_S} to ${TIMEOUT_MAX_S}.` };
    }
    next.timeoutS = n;
  }
  next.updatedAt = new Date();
  next.updatedBy = by;
  await d.collection(SETTINGS_COLLECTION).replaceOne({ _id: TRANSLATE_OPTIONS }, next, { upsert: true });
  resetTranslate({ stats: false }); // the app reads it again at once; a pause from a failure ends
  return { ok: true, options: await translateOptions(d) };
}

export async function translateTry(d, input = {}) {
  const text = String(input?.text ?? "").trim();
  const from = String(input?.from ?? "");
  const to = String(input?.to ?? "");
  if (!text) return { ok: false, status: 422, field: "text", error: "Write a line to translate." };
  if (Array.from(text).length > TRY_TEXT_MAX) return { ok: false, status: 422, field: "text", error: `At most ${TRY_TEXT_MAX} characters.` };
  if (!LANG_NAMES[from]) return { ok: false, status: 422, field: "from", error: "Pick the language it is written in." };
  if (to !== "all" && (!LANG_NAMES[to] || to === from)) return { ok: false, status: 422, field: "to", error: "Pick another language to translate into." };
  const c = await translateConfig({ d, fresh: true });
  if (!c) return { ok: false, status: 400, reason: "not_set", error: "Save the address, model and token first." };
  const targets = to === "all" ? Object.keys(LANG_NAMES).filter((l) => l !== from) : [to];
  // One after the other: the M1 answers one line at a time anyway, and the times then mean something.
  const results = [];
  for (const l of targets) results.push({ to: l, ...(await tryTranslate(c, { text, from, to: l })) });
  const ok = results.every((r) => r.ok);
  const bad = results.find((r) => !r.ok);
  if (c.source === "tower") {
    await noteSecretUse(d, TRANSLATE_SETTING, { ok, reason: ok ? null : "failed", detail: bad?.error ?? null, kind: "try" }).catch(() => {});
  }
  return { ok, from, results, model: c.model, host: hostOf(c.url), style: c.style, enabled: c.enabled };
}

export { endpointOf };
