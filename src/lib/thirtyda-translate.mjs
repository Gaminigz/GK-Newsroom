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
 * chat stays fast while the M1 is down. A small in-memory cache (1,000 lines) and counters for the tower (translateStats).
 * System questions and Level-1 answer options never come through here; they are translated by hand in shared/questions.js.
 *
 * The config is read from the database the server hands in (useTranslateDb, on its first request); the unit tests of the
 * app hand in none, so they read only the env (and the env is cleared there: nothing leaves a test).
 */
import { readFields, SETTINGS_COLLECTION } from "./thirtyda-settings.mjs";

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

let downUntil = 0;
const cache = new Map();
let dbOf = null;
let config = null; // { at, value }
let hooks = { fetchImpl: null, now: null };
const stats = { calls: 0, ok: 0, failed: 0, cached: 0, totalMs: 0, lastOk: null, lastError: null };

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
  downUntil = 0;
  cache.clear();
  if (alsoStats) Object.assign(stats, { calls: 0, ok: 0, failed: 0, cached: 0, totalMs: 0, lastOk: null, lastError: null });
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

/** True when a provider is set, switched on, and not pausing after a failure. */
export async function translateEnabled() {
  const c = await translateConfig();
  return Boolean(c?.enabled) && now() >= downUntil;
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
        {
          role: "system",
          content:
            `You translate short messages between two adults on a calm dating app in Phnom Penh. ` +
            `Translate the user's message from ${LANG_NAMES[from]} to ${LANG_NAMES[to]}. ` +
            `Reply with the translation only: no quotes, notes, romanisation or explanations. ` +
            `Keep names, numbers and emoji exactly as they are.`,
        },
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

/** Translate `text` from one app language to another. Resolves to null when unavailable. */
export async function translate(text, from, to) {
  text = String(text ?? "").trim();
  if (!text || !LANG_NAMES[from] || !LANG_NAMES[to]) return null;
  if (from === to) return text;
  const c = await translateConfig();
  if (!c?.enabled || now() < downUntil) return null;

  const key = `${from}>${to}:${text}`;
  if (cache.has(key)) {
    stats.cached++;
    return cache.get(key);
  }
  stats.calls++;
  const started = now();
  try {
    const out = await ask(c, text.slice(0, TEXT_MAX), from, to);
    const ms = now() - started;
    stats.ok++;
    stats.totalMs += ms;
    stats.lastOk = { at: now(), ms, from, to };
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, out);
    return out;
  } catch (err) {
    // One failure pauses the provider for a minute so chat stays fast while M1 is down.
    downUntil = now() + COOL_OFF_MS;
    stats.failed++;
    stats.lastError = { at: now(), message: String(err instanceof Error ? err.message : err).slice(0, 160) };
    console.error("[30da translate]", stats.lastError.message);
    return null;
  }
}

/**
 * The tower's Try: one line through `c` (translateConfig, even while switched off), no cache, no pause, not counted
 * in the app's numbers → { ok, text, ms } | { ok: false, error, ms }.
 */
export async function tryTranslate(c, { text, from, to }) {
  const started = now();
  try {
    const out = await ask(c, String(text).slice(0, TEXT_MAX), from, to);
    return { ok: true, text: out, ms: now() - started };
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err).slice(0, 160), ms: now() - started };
  }
}

/** What the app's translations did since the server started (the tower shows it). Never a line of text. */
export function translateStats() {
  const t = now();
  return {
    calls: stats.calls,
    ok: stats.ok,
    failed: stats.failed,
    cached: stats.cached,
    avgMs: stats.ok ? Math.round(stats.totalMs / stats.ok) : null,
    lastOk: stats.lastOk ? { ...stats.lastOk, at: new Date(stats.lastOk.at).toISOString() } : null,
    lastError: stats.lastError ? { ...stats.lastError, at: new Date(stats.lastError.at).toISOString() } : null,
    pausedUntil: downUntil > t ? new Date(downUntil).toISOString() : null,
  };
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
