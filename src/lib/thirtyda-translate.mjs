/**
 * 30+DA translation — "We will translate for you".
 *
 * Provider: an OpenAI-compatible chat-completions endpoint, by default our own M1 box (llm.ggmt.sg: the M1 guard, a
 * bearer token, LM Studio behind it). Set on the admin Code page, Tower 13 · Translate (src/lib/thirtyda-hub-translate.mjs,
 * owner 2026-10-15): thirtyda_settings 'translate' — { url, model, token (sealed, shown as its last 4), style } — and
 * 'translate_options' — { enabled, timeoutS }. Nothing saved there → the env, as before:
 *   THIRTYDA_TRANSLATE_URL    base URL or full …/v1/chat/completions URL
 *   THIRTYDA_TRANSLATE_KEY    optional bearer token
 *   THIRTYDA_TRANSLATE_MODEL  optional model name
 *   THIRTYDA_TRANSLATE_STYLE  optional 'hy-mt' | 'chat' (else from the model's name: a Hy-MT / Hunyuan-MT model → 'hy-mt')
 * Neither → translate() returns null and the app shows the original only.
 *
 * Two prompt styles (translateRequest):
 *   'hy-mt'  Tencent Hy-MT / Hunyuan-MT (the pick: Apache-2.0, knows Khmer): NO system prompt — the model card's own
 *            instruction goes in the user turn ("Translate the following segment into Khmer, without additional
 *            explanation." / for Chinese "把下面的文本翻译成…，不要额外解释。"), with its recommended sampling.
 *   'chat'   any instruction model (Qwen …): a short system prompt, as before.
 *
 * Each call waits at most the tower's timeout (15 s by default, 5–30); one failure pauses the provider for a minute so
 * chat stays fast while the M1 is down.
 *
 * The backup (owner 2026-10-17, "option 3"): the PAID Gemini API (Google AI Studio / Cloud, billing on: Google does not
 * train on what the paid API is sent). Asked only when the M1 cannot answer — not set, Off, pausing after a failure,
 * no answer in time or an error. Set on Tower 13 too: thirtyda_settings 'translategemini' { key (sealed, last 4 only),
 * model } and 'translate_gemini_options' { enabled (off until "Turn on"), monthlyCap }; its own month's counts in
 * 'translate_gemini_usage' (Phnom Penh months; past the cap it is not asked until the 1st). A one-minute pause after
 * its own failure too. Both down → null: the app shows the original line, as before. Never the consumer Gemini site or
 * Agent Desk (tower 14) for a chat line. A small in-memory cache (1,000 lines) and counters for the tower (translateStats).
 * System questions and Level-1 answer options never come through here; they are translated by hand in shared/questions.js.
 *
 * The config is read from the database the server hands in (useTranslateDb, on its first request); the unit tests of the
 * app hand in none, so they read only the env (and the env is cleared there: nothing leaves a test).
 */
import { readFields, SETTINGS_COLLECTION } from "./thirtyda-settings.mjs";
import { PP_OFFSET_MS } from "../thirtyda-app/shared/meet.js";

export const LANG_NAMES = Object.freeze({ en: "English", km: "Khmer", zh: "Simplified Chinese", ko: "Korean", ja: "Japanese" });
/** The target language as Hy-MT's Chinese instruction names it. */
const LANG_NAMES_ZH = Object.freeze({ en: "英语", km: "高棉语", zh: "中文", ko: "韩语", ja: "日语" });
export const TRANSLATE_SETTING = "translate";
export const TRANSLATE_OPTIONS = "translate_options";
export const STYLES = Object.freeze(["hy-mt", "chat"]);
export const TIMEOUT_DEFAULT_S = 15;
export const TIMEOUT_MIN_S = 5;
export const TIMEOUT_MAX_S = 30;
export const COOL_OFF_MS = 60 * 1000;
const CACHE_MAX = 1000;
/** How long a read config is used before it is read again (a save on the tower clears it at once). */
const CONFIG_MS = 30e3;
const TEXT_MAX = 2000;

// The backup: the paid Gemini API (Google AI for Developers, generateContent).
export const GEMINI_SETTING = "translategemini";
export const GEMINI_OPTIONS = "translate_gemini_options";
export const GEMINI_USAGE = "translate_gemini_usage";
/** A small, stable Flash-Lite model (checked 2026-10-17: gemini-3.5-flash-lite; its thinking defaults to "minimal"). */
export const GEMINI_MODEL_DEFAULT = "gemini-3.5-flash-lite";
export const GEMINI_TIMEOUT_MS = 10000;
/** Lines a month (Phnom Penh time) at most; a Flash-Lite line costs a tiny fraction of a cent. */
export const GEMINI_CAP_DEFAULT = 20000;
export const GEMINI_CAP_MAX = 1000000;
export const geminiUrl = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
export const PROVIDERS = Object.freeze(["m1", "gemini"]);

const down = { m1: 0, gemini: 0 }; // a provider pauses a minute after its own failure
const cache = new Map();
let dbOf = null;
let config = null; // { at, value }
let geminiConf = null; // { at, value }
let hooks = { fetchImpl: null, now: null };
const freshStats = () => ({ calls: 0, ok: 0, failed: 0, totalMs: 0, lastOk: null, lastError: null });
const stats = { cached: 0, m1: freshStats(), gemini: freshStats() };

const now = () => (hooks.now ? hooks.now() : Date.now());
const doFetch = (url, init) => (hooks.fetchImpl ?? globalThis.fetch)(url, init);

/** The server's database, for the tower's settings (the first one handed in stays). */
export function useTranslateDb(d) {
  if (d && !dbOf) dbOf = d;
}

/** Tests only: a database, a fetch and a clock; everything else back to a fresh start. */
export function setTranslateTestHooks({ db = null, fetchImpl = null, now: clock = null } = {}) {
  dbOf = db;
  hooks = { fetchImpl, now: clock };
  resetTranslate();
}

/** A save, a removal or On / Off on the tower: read the config again, forget the cache and the pause. */
export function resetTranslate({ stats: alsoStats = true } = {}) {
  config = null;
  geminiConf = null;
  down.m1 = 0;
  down.gemini = 0;
  cache.clear();
  if (alsoStats) Object.assign(stats, { cached: 0, m1: freshStats(), gemini: freshStats() });
}

/** "https://llm.ggmt.sg" | "…/v1" | "…/v1/chat/completions" → the chat-completions URL (null when empty). */
export function endpointOf(raw) {
  const s = String(raw ?? "").trim().replace(/\/+$/, "");
  if (!s) return null;
  if (/\/chat\/completions$/.test(s)) return s;
  return /\/v1$/.test(s) ? `${s}/chat/completions` : `${s}/v1/chat/completions`;
}

/** A model's name → its prompt style: Hy-MT / Hunyuan-MT take no system prompt. */
export const styleOfModel = (model) => (/hy-?mt|hunyuan-?mt/i.test(String(model ?? "")) ? "hy-mt" : "chat");

const clampTimeout = (s) => (Number.isInteger(s) && s >= TIMEOUT_MIN_S && s <= TIMEOUT_MAX_S ? s : TIMEOUT_DEFAULT_S);

/**
 * The tower's On / Off and timeout (thirtyda_settings 'translate_options'). enabled: null when never pressed — then the
 * tower's own keys stay OFF until "Turn on" (try it first: a Khmer speaker checks the lines), the env's are on as before.
 */
export async function translateOptions(d) {
  const doc = d ? await d.collection(SETTINGS_COLLECTION).findOne({ _id: TRANSLATE_OPTIONS }) : null;
  return {
    enabled: typeof doc?.enabled === "boolean" ? doc.enabled : null,
    timeoutS: clampTimeout(doc?.timeoutS),
    updatedAt: doc?.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
  };
}

/**
 * Where translations go now → { source: 'tower' | 'env', url, model, token, style, enabled, timeoutMs } or null when
 * nothing is set. The tower's saved settings win over the env. `fresh`: read again now (the tower).
 */
export async function translateConfig({ d = dbOf, env = process.env, fresh = false } = {}) {
  if (!fresh && config && now() - config.at < CONFIG_MS) return config.value;
  let value = null;
  let options = { enabled: null, timeoutS: TIMEOUT_DEFAULT_S };
  try {
    if (d) {
      options = await translateOptions(d);
      const f = await readFields(d, TRANSLATE_SETTING);
      const url = endpointOf(f?.url);
      if (url) value = { source: "tower", url, model: f.model || null, token: f.token || null, style: STYLES.includes(f.style) ? f.style : styleOfModel(f.model) };
    }
  } catch (err) {
    console.error("[30da translate] settings:", err instanceof Error ? err.message : err);
  }
  if (!value) {
    const url = endpointOf(env.THIRTYDA_TRANSLATE_URL);
    const model = String(env.THIRTYDA_TRANSLATE_MODEL ?? "").trim() || null;
    const style = STYLES.includes(env.THIRTYDA_TRANSLATE_STYLE) ? env.THIRTYDA_TRANSLATE_STYLE : styleOfModel(model);
    if (url) value = { source: "env", url, model, token: String(env.THIRTYDA_TRANSLATE_KEY ?? "").trim() || null, style };
  }
  if (value) value = { ...value, enabled: options.enabled ?? value.source === "env", timeoutMs: clampTimeout(options.timeoutS) * 1000 };
  config = { at: now(), value };
  return value;
}

// ---------------------------------------------------------------- the backup: the paid Gemini API

/** "YYYY-MM" in Phnom Penh time: the month the backup's cap counts in. */
export const monthOf = (ms) => new Date(ms + PP_OFFSET_MS).toISOString().slice(0, 7);

/** The backup's On / Off (off until turned on) and monthly cap. */
export async function geminiOptions(d) {
  const doc = d ? await d.collection(SETTINGS_COLLECTION).findOne({ _id: GEMINI_OPTIONS }) : null;
  const cap = Number.isInteger(doc?.monthlyCap) ? doc.monthlyCap : GEMINI_CAP_DEFAULT;
  return { enabled: doc?.enabled === true, monthlyCap: cap, updatedAt: doc?.updatedAt ? new Date(doc.updatedAt).toISOString() : null };
}

/** This month's counts of the backup (a new month starts at 0). Counts only, never a line. */
export async function geminiUsage(d, at = now()) {
  const doc = d ? await d.collection(SETTINGS_COLLECTION).findOne({ _id: GEMINI_USAGE }) : null;
  const month = monthOf(at);
  const same = doc?.month === month;
  const iso = (t) => (t ? new Date(t).toISOString() : null);
  return {
    month,
    calls: same ? doc.calls ?? 0 : 0,
    ok: same ? doc.ok ?? 0 : 0,
    failed: same ? doc.failed ?? 0 : 0,
    lastOk: doc?.lastOk ? { at: iso(doc.lastOk.at), ms: doc.lastOk.ms ?? null } : null,
    lastError: doc?.lastError ? { at: iso(doc.lastError.at), message: doc.lastError.message } : null,
  };
}

/** One call to the backup counted (ok or not). */
async function countGemini(d, { ok, ms = null, message = null }) {
  if (!d) return;
  const coll = d.collection(SETTINGS_COLLECTION);
  const t = now();
  const month = monthOf(t);
  await coll.updateOne({ _id: GEMINI_USAGE, month: { $ne: month } }, { $set: { month, calls: 0, ok: 0, failed: 0 } });
  await coll.updateOne(
    { _id: GEMINI_USAGE },
    {
      $setOnInsert: { month },
      $inc: { calls: 1, ok: ok ? 1 : 0, failed: ok ? 0 : 1 },
      $set: ok ? { lastOk: { at: new Date(t), ms } } : { lastError: { at: new Date(t), message: String(message).slice(0, 200) } },
    },
    { upsert: true },
  );
}

/** The backup now → { key, model, enabled, monthlyCap } or null (no key saved). Read at most every 30 s. */
export async function geminiConfig({ d = dbOf, fresh = false } = {}) {
  if (!fresh && geminiConf && now() - geminiConf.at < CONFIG_MS) return geminiConf.value;
  let value = null;
  try {
    if (d) {
      const [f, o] = await Promise.all([readFields(d, GEMINI_SETTING), geminiOptions(d)]);
      if (f?.key) value = { key: f.key, model: f.model || GEMINI_MODEL_DEFAULT, enabled: o.enabled, monthlyCap: o.monthlyCap };
    }
  } catch (err) {
    console.error("[30da translate] gemini settings:", err instanceof Error ? err.message : err);
  }
  geminiConf = { at: now(), value };
  return value;
}

/** The generateContent body for one line: the same short instruction as a chat model, as the system instruction. */
export function geminiRequest({ text, from, to }) {
  return {
    systemInstruction: { parts: [{ text: chatInstruction(from, to) }] },
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
  };
}

/** One call to the Gemini API → the translation (throws with plain words; never the key). */
async function askGemini(g, text, from, to, timeoutMs = GEMINI_TIMEOUT_MS) {
  let res;
  try {
    res = await doFetch(geminiUrl(g.model), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": g.key },
      body: JSON.stringify(geminiRequest({ text, from, to })),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") throw new Error(`no answer in ${Math.round(timeoutMs / 1000)} s`);
    throw new Error("could not reach Google");
  }
  const j = await res.json().catch(() => null);
  if (!res.ok) {
    const said = typeof j?.error?.message === "string" ? j.error.message.replace(/\s+/g, " ").slice(0, 120) : "";
    throw new Error(`Gemini HTTP ${res.status}${said ? ` (${said})` : ""}`);
  }
  if (j?.promptFeedback?.blockReason) throw new Error(`blocked: ${String(j.promptFeedback.blockReason).slice(0, 40)}`);
  const parts = j?.candidates?.[0]?.content?.parts;
  const out = cleanTranslation(Array.isArray(parts) ? parts.filter((x) => !x?.thought).map((x) => x?.text ?? "").join("") : "");
  if (!out) throw new Error(`empty reply${j?.candidates?.[0]?.finishReason ? ` (${j.candidates[0].finishReason})` : ""}`);
  return out;
}

/** The backup can be asked now: a key, switched on, not pausing, under this month's cap. */
async function geminiReady(g) {
  if (!g?.key || !g.enabled || now() < down.gemini) return false;
  const used = await geminiUsage(dbOf, now());
  return used.calls < g.monthlyCap;
}

/** True when the M1 or the backup can be asked now (set, switched on, not pausing; the backup under its cap). */
export async function translateEnabled() {
  const c = await translateConfig();
  if (c?.enabled && now() >= down.m1) return true;
  return geminiReady(await geminiConfig()).catch(() => false);
}

/**
 * The chat-completions body for one line (pure). 'hy-mt': the model card's instruction in the user turn, no system
 * prompt, its sampling (top_k 20, top_p 0.6, repetition 1.05, temperature 0.7). 'chat': a system prompt, temperature 0.2.
 */
export function translateRequest({ text, from, to, model = null, style = "chat" }) {
  let body;
  if (style === "hy-mt") {
    const content = from === "zh" || to === "zh"
      ? `把下面的文本翻译成${LANG_NAMES_ZH[to]}，不要额外解释。\n\n${text}`
      : `Translate the following segment into ${LANG_NAMES[to]}, without additional explanation.\n\n${text}`;
    body = {
      messages: [{ role: "user", content }],
      temperature: 0.7, top_p: 0.6, top_k: 20, repeat_penalty: 1.05,
    };
  } else {
    body = {
      messages: [
        { role: "system", content: chatInstruction(from, to) },
        { role: "user", content: text },
      ],
      temperature: 0.2,
    };
  }
  body.max_tokens = 512;
  body.stream = false;
  if (model) body.model = model;
  return body;
}

/** The short instruction a chat model (and the Gemini API) gets. */
function chatInstruction(from, to) {
  return `You translate short messages between two adults on a calm dating app in Phnom Penh. ` +
    `Translate the user's message from ${LANG_NAMES[from]} to ${LANG_NAMES[to]}. ` +
    `Reply with the translation only: no quotes, notes, romanisation or explanations. ` +
    `Keep names, numbers and emoji exactly as they are.`;
}

export function cleanTranslation(out) {
  return String(out || "")
    .replace(/<think>[\s\S]*?<\/think>/g, "") // reasoning models
    .trim()
    .replace(/^["“”'「]+|["“”'」]+$/g, "")
    .trim();
}

/** One call to the provider → the translation (throws with plain words: HTTP status, empty reply, timeout). */
async function ask(c, text, from, to) {
  const headers = { "Content-Type": "application/json" };
  if (c.token) headers.Authorization = `Bearer ${c.token}`;
  let res;
  try {
    res = await doFetch(c.url, {
      method: "POST",
      headers,
      body: JSON.stringify(translateRequest({ text, from, to, model: c.model, style: c.style })),
      signal: AbortSignal.timeout(c.timeoutMs),
    });
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") throw new Error(`no answer in ${Math.round(c.timeoutMs / 1000)} s`);
    throw new Error(`could not reach ${new URL(c.url).host}`);
  }
  if (!res.ok) {
    // The guard's / LM Studio's own words ("bad token", "model not found"): never our token, never the line.
    const j = await res.json().catch(() => null);
    const said = j?.detail ?? j?.error?.message ?? j?.error;
    const detail = typeof said === "string" ? said.slice(0, 80) : "";
    throw new Error(`HTTP ${res.status}${detail ? ` (${detail})` : ""}`);
  }
  const data = await res.json();
  const out = cleanTranslation(data?.choices?.[0]?.message?.content);
  if (!out) throw new Error("empty reply");
  return out;
}

const noteOk = (p, ms, from, to) => {
  const st = stats[p];
  st.calls++;
  st.ok++;
  st.totalMs += ms;
  st.lastOk = { at: now(), ms, from, to };
};
const noteFail = (p, err) => {
  const st = stats[p];
  st.calls++;
  st.failed++;
  st.lastError = { at: now(), message: String(err instanceof Error ? err.message : err).slice(0, 160) };
  down[p] = now() + COOL_OFF_MS; // a minute's pause: chat stays fast while that provider is down
  console.error(`[30da translate] ${p}:`, st.lastError.message);
};

/**
 * Translate `text` from one app language to another: the M1 first, the paid Gemini API when the M1 cannot answer.
 * Resolves to null when neither can (the app shows the original line).
 */
export async function translate(text, from, to) {
  text = String(text ?? "").trim();
  if (!text || !LANG_NAMES[from] || !LANG_NAMES[to]) return null;
  if (from === to) return text;
  const key = `${from}>${to}:${text}`;
  if (cache.has(key)) {
    stats.cached++;
    return cache.get(key);
  }
  const line = text.slice(0, TEXT_MAX);
  const keep = (out) => {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, out);
    return out;
  };
  const c = await translateConfig();
  if (c?.enabled && now() >= down.m1) {
    const started = now();
    try {
      const out = await ask(c, line, from, to);
      noteOk("m1", now() - started, from, to);
      return keep(out);
    } catch (err) {
      noteFail("m1", err);
    }
  }
  const g = await geminiConfig();
  if (await geminiReady(g).catch(() => false)) {
    const started = now();
    try {
      const out = await askGemini(g, line, from, to);
      const ms = now() - started;
      noteOk("gemini", ms, from, to);
      await countGemini(dbOf, { ok: true, ms }).catch(() => {});
      return keep(out);
    } catch (err) {
      noteFail("gemini", err);
      await countGemini(dbOf, { ok: false, message: stats.gemini.lastError.message }).catch(() => {});
    }
  }
  return null;
}

/**
 * The tower's Try: one line through `c` (translateConfig, even while switched off), no cache, no pause, not counted
 * in the app's numbers → { ok, text, ms } | { ok: false, error, ms }. provider 'gemini': `c` is geminiConfig, and the
 * call counts against the backup's month (it is paid) — refused past the cap.
 */
export async function tryTranslate(c, { text, from, to, provider = "m1", d = dbOf }) {
  const started = now();
  try {
    if (provider === "gemini") {
      const used = await geminiUsage(d, now());
      if (used.calls >= c.monthlyCap) throw new Error("this month's cap is reached");
    }
    const out = provider === "gemini"
      ? await askGemini(c, String(text).slice(0, TEXT_MAX), from, to)
      : await ask(c, String(text).slice(0, TEXT_MAX), from, to);
    const ms = now() - started;
    if (provider === "gemini") await countGemini(d, { ok: true, ms }).catch(() => {});
    return { ok: true, text: out, ms };
  } catch (err) {
    const error = String(err instanceof Error ? err.message : err).slice(0, 160);
    if (provider === "gemini" && error !== "this month's cap is reached") await countGemini(d, { ok: false, message: error }).catch(() => {});
    return { ok: false, error, ms: now() - started };
  }
}

/**
 * What the app's translations did since the server started (the tower shows it): the M1's numbers at the top, the
 * backup's under `gemini`, the cache's hits in `cached`. Never a line of text.
 */
export function translateStats() {
  const t = now();
  const one = (p) => {
    const st = stats[p];
    return {
      calls: st.calls,
      ok: st.ok,
      failed: st.failed,
      avgMs: st.ok ? Math.round(st.totalMs / st.ok) : null,
      lastOk: st.lastOk ? { ...st.lastOk, at: new Date(st.lastOk.at).toISOString() } : null,
      lastError: st.lastError ? { ...st.lastError, at: new Date(st.lastError.at).toISOString() } : null,
      pausedUntil: down[p] > t ? new Date(down[p]).toISOString() : null,
    };
  };
  return { ...one("m1"), cached: stats.cached, gemini: one("gemini") };
}

/**
 * Translations into every app language, for storing on write.
 * → { translations: { en, km, zh, ko, ja }, english: string|null }
 * `translations[from]` is the original; a language that failed is null.
 * `english` is null when the original is English.
 */
export async function translateAll(text, from, langs = Object.keys(LANG_NAMES)) {
  const pairs = await Promise.all(langs.map(async (l) => [l, l === from ? text : await translate(text, from, l)]));
  const translations = Object.fromEntries(pairs);
  return { translations, english: from === "en" ? null : translations.en ?? null };
}
