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
 *   translateTry(d, { text, from, to, provider? }) → one line (or `to: 'all'`: into the 4 other languages) through what
 *     is saved, even while Off; the outcome is noted on the card (noteSecretUse, kind 'try'), never the text. provider:
 *     'm1' (default) or 'gemini' (the backup; counted against its month: it is paid).
 *
 * The backup (owner 2026-10-17, "option 3"): the PAID Gemini API, asked only when the M1 cannot answer
 * (src/lib/thirtyda-translate.mjs). Its key and model are saved through the generic PUT / DELETE
 * /api/connections/translategemini; checkGeminiFields checks them; saveGeminiOptions { enabled?, monthlyCap? }; the
 * view's `gemini` block: the key's last 4, the model, On / Off, the month's counts and cap, the app's numbers since start.
 */
import { SETTINGS_COLLECTION, fieldsStatus, noteSecretUse } from "./thirtyda-settings.mjs";
import {
  LANG_NAMES, STYLES, TRANSLATE_SETTING, TRANSLATE_OPTIONS, TIMEOUT_MIN_S, TIMEOUT_MAX_S, translateConfig, translateOptions,
  translateStats, tryTranslate, resetTranslate, endpointOf, styleOfModel, PROVIDERS, GEMINI_SETTING, GEMINI_OPTIONS,
  GEMINI_MODEL_DEFAULT, GEMINI_CAP_MAX, geminiConfig, geminiOptions, geminiUsage,
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

/** A Google API key: "AIza" + 35 letters, digits, - and _. */
const GEMINI_KEY_RE = /^AIza[0-9A-Za-z_-]{35}$/;
const GEMINI_MODEL_RE = /^gemini-[a-z0-9][a-z0-9.-]{1,60}$/;

/** The backup's boxes → checked values. An empty key box keeps the saved key; an empty model is the default one. */
export function checkGeminiFields(input = {}, current = null) {
  let key = String(input?.key ?? "").trim();
  if (!key && current?.key) key = current.key;
  if (!key) return { ok: false, field: "key", error: "Paste the Gemini API key first (it starts with AIza)." };
  if (!GEMINI_KEY_RE.test(key)) return { ok: false, field: "key", error: "That is not a Google API key: it starts with AIza and is 39 letters and digits long." };
  const model = String(input?.model ?? "").trim().toLowerCase() || GEMINI_MODEL_DEFAULT;
  if (!GEMINI_MODEL_RE.test(model)) return { ok: false, field: "model", error: `A Gemini model name, like ${GEMINI_MODEL_DEFAULT}.` };
  return { ok: true, values: { key, model } };
}

/** The backup's state: not_set · unreadable · off · cap · failing · saved (on, never asked) · live. */
function geminiState(saved, options, usage, st) {
  if (!saved.set) return "not_set";
  if (!saved.readable) return "unreadable";
  if (!options.enabled) return "off";
  if (usage.calls >= options.monthlyCap) return "cap";
  const okAt = Math.max(Date.parse(usage.lastOk?.at) || 0, Date.parse(st.lastOk?.at) || 0);
  const badAt = Math.max(Date.parse(usage.lastError?.at) || 0, Date.parse(st.lastError?.at) || 0);
  if (st.pausedUntil || badAt > okAt) return "failing";
  return okAt ? "live" : "saved";
}

async function geminiView(d, st) {
  const [saved, options, usage] = await Promise.all([fieldsStatus(d, GEMINI_SETTING), geminiOptions(d), geminiUsage(d)]);
  return {
    id: GEMINI_SETTING,
    state: geminiState(saved, options, usage, st.gemini),
    ...saved,
    modelDefault: GEMINI_MODEL_DEFAULT,
    options,
    usage,
    capRange: [0, GEMINI_CAP_MAX],
    stats: st.gemini,
  };
}

/** The tower's pill from both providers: the better one shows (one live is enough for the app). */
function towerStatus(m1, gemini) {
  const g = { not_set: "not_set", unreadable: "not_set", off: "off", cap: "failing", failing: "failing", saved: "saved", live: "live" }[gemini];
  for (const s of ["live", "failing", "saved", "off"]) if (m1 === s || g === s) return s;
  return "not_set";
}

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
  let m1 = "not_set";
  if (c && !c.enabled) m1 = "off";
  else if (c && (st.pausedUntil || lastBadAt > lastOkAt)) m1 = "failing";
  else if (c && lastOkAt) m1 = "live";
  else if (c) m1 = "saved";
  const gemini = await geminiView(d, st);
  return {
    id: TRANSLATE_SETTING,
    status: towerStatus(m1, gemini.state),
    m1Status: m1,
    gemini,
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

/** The backup's On / Off (off until turned on) and monthly cap → { ok, options } | { ok: false, field, error }. */
export async function saveGeminiOptions(d, input, { by = "superadmin" } = {}) {
  const v = input && typeof input === "object" ? input : {};
  const cur = await geminiOptions(d);
  const next = { _id: GEMINI_OPTIONS, kind: "options", enabled: cur.enabled, monthlyCap: cur.monthlyCap };
  if ("enabled" in v) {
    if (typeof v.enabled !== "boolean") return { ok: false, field: "enabled", error: "On or Off." };
    next.enabled = v.enabled;
  }
  if ("monthlyCap" in v) {
    const n = v.monthlyCap;
    if (!Number.isInteger(n) || n < 0 || n > GEMINI_CAP_MAX) {
      return { ok: false, field: "monthlyCap", error: `A whole number of lines from 0 to ${GEMINI_CAP_MAX.toLocaleString("en-GB")}.` };
    }
    next.monthlyCap = n;
  }
  next.updatedAt = new Date();
  next.updatedBy = by;
  await d.collection(SETTINGS_COLLECTION).replaceOne({ _id: GEMINI_OPTIONS }, next, { upsert: true });
  resetTranslate({ stats: false });
  return { ok: true, options: await geminiOptions(d) };
}

export async function translateTry(d, input = {}) {
  const text = String(input?.text ?? "").trim();
  const from = String(input?.from ?? "");
  const to = String(input?.to ?? "");
  if (!text) return { ok: false, status: 422, field: "text", error: "Write a line to translate." };
  if (Array.from(text).length > TRY_TEXT_MAX) return { ok: false, status: 422, field: "text", error: `At most ${TRY_TEXT_MAX} characters.` };
  if (!LANG_NAMES[from]) return { ok: false, status: 422, field: "from", error: "Pick the language it is written in." };
  if (to !== "all" && (!LANG_NAMES[to] || to === from)) return { ok: false, status: 422, field: "to", error: "Pick another language to translate into." };
  const provider = input?.provider == null ? "m1" : String(input.provider);
  if (!PROVIDERS.includes(provider)) return { ok: false, status: 422, field: "provider", error: "Pick the M1 or the Gemini API." };
  const targets = to === "all" ? Object.keys(LANG_NAMES).filter((l) => l !== from) : [to];
  if (provider === "gemini") {
    const g = await geminiConfig({ d, fresh: true });
    if (!g) return { ok: false, status: 400, reason: "not_set", error: "Save the Gemini API key first." };
    const results = [];
    for (const l of targets) results.push({ to: l, ...(await tryTranslate(g, { text, from, to: l, provider, d })) });
    return { ok: results.every((r) => r.ok), from, results, provider, model: g.model, host: "generativelanguage.googleapis.com", enabled: g.enabled };
  }
  const c = await translateConfig({ d, fresh: true });
  if (!c) return { ok: false, status: 400, reason: "not_set", error: "Save the address, model and token first." };
  // One after the other: the M1 answers one line at a time anyway, and the times then mean something.
  const results = [];
  for (const l of targets) results.push({ to: l, ...(await tryTranslate(c, { text, from, to: l })) });
  const ok = results.every((r) => r.ok);
  const bad = results.find((r) => !r.ok);
  if (c.source === "tower") {
    await noteSecretUse(d, TRANSLATE_SETTING, { ok, reason: ok ? null : "failed", detail: bad?.error ?? null, kind: "try" }).catch(() => {});
  }
  return { ok, from, results, provider, model: c.model, host: hostOf(c.url), style: c.style, enabled: c.enabled };
}

export { endpointOf };
