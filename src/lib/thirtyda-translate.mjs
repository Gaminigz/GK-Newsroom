/**
 * 30+DA translation — "We will translate for you".
 *
 * Provider: an OpenAI-compatible chat-completions endpoint on our own M1 box
 * (llm.ggmt.sg), chosen by env:
 *   THIRTYDA_TRANSLATE_URL    base URL or full …/v1/chat/completions URL
 *   THIRTYDA_TRANSLATE_KEY    optional bearer token
 *   THIRTYDA_TRANSLATE_MODEL  optional model name
 * Unset → translate() returns null and the app shows the original only.
 * System questions and Level-1 answer options never come through here; they
 * are translated by hand in shared/questions.js.
 */

const LANG_NAMES = { en: "English", km: "Khmer", zh: "Simplified Chinese", ko: "Korean", ja: "Japanese" };
const TIMEOUT_MS = 8000;
const COOL_OFF_MS = 60 * 1000;
const CACHE_MAX = 1000;

let downUntil = 0;
const cache = new Map();

function endpoint() {
  const raw = (process.env.THIRTYDA_TRANSLATE_URL || "").trim().replace(/\/+$/, "");
  if (!raw) return null;
  if (/\/chat\/completions$/.test(raw)) return raw;
  return /\/v1$/.test(raw) ? `${raw}/chat/completions` : `${raw}/v1/chat/completions`;
}

/** True when a provider is configured and not cooling off after a failure. */
export function translateEnabled() {
  return Boolean(endpoint()) && Date.now() >= downUntil;
}

function clean(out) {
  return String(out || "")
    .replace(/<think>[\s\S]*?<\/think>/g, "") // reasoning models
    .trim()
    .replace(/^["“”'「]+|["“”'」]+$/g, "")
    .trim();
}

/** Translate `text` from one app language to another. Resolves to null when unavailable. */
export async function translate(text, from, to) {
  text = String(text ?? "").trim();
  if (!text || !LANG_NAMES[from] || !LANG_NAMES[to]) return null;
  if (from === to) return text;
  const url = endpoint();
  if (!url || Date.now() < downUntil) return null;

  const key = `${from}>${to}:${text}`;
  if (cache.has(key)) return cache.get(key);

  const headers = { "Content-Type": "application/json" };
  if (process.env.THIRTYDA_TRANSLATE_KEY) headers.Authorization = `Bearer ${process.env.THIRTYDA_TRANSLATE_KEY}`;
  const body = {
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
    max_tokens: 400,
    stream: false,
  };
  if (process.env.THIRTYDA_TRANSLATE_MODEL) body.model = process.env.THIRTYDA_TRANSLATE_MODEL;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`translate HTTP ${res.status}`);
    const data = await res.json();
    const out = clean(data?.choices?.[0]?.message?.content);
    if (!out) throw new Error("translate: empty reply");
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, out);
    return out;
  } catch (err) {
    // One failure pauses the provider for a minute so chat stays fast while M1 is down.
    downUntil = Date.now() + COOL_OFF_MS;
    console.error("[30da translate]", err instanceof Error ? err.message : err);
    return null;
  }
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
