/**
 * Paste-a-menu parser.
 *
 * A shop owner writes the day's menu in WhatsApp long before they open the
 * app — headings, dish names in English and Sinhala, a price here and there,
 * "select 04 items". This turns that text into the Plan Menu structure so
 * they paste once instead of ticking thirty boxes.
 *
 * Gemini does the reading (`gemini-flash-latest`, JSON schema out). If the
 * key is missing or the call fails there is a rules fallback below — it is
 * blunter but it keeps the button working rather than showing an error.
 *
 * Nothing here touches Mongo. The route (`/menu/paste.json` in app.mjs)
 * decides what to create; this only reports what the text says.
 */

import { GoogleGenAI, Type } from "@google/genai";

/** The rate the whole shop suite prices at — money() in the Plan Menu page
 *  divides by the same number. A "$5" on a pasted menu is LKR 1,500. */
export const USD_LKR = 300;

/** "5$" → 1500. "Rs 750" / "LKR 750" / "750" → 750. "" → null.
 *  Anything with a $ or "usd" is dollars; everything else is rupees, which
 *  is what an unmarked number means on a Sri Lankan menu. */
export function priceToLkr(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return null;
  const m = s.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const usd = /\$|usd|dollar/i.test(s);
  return Math.round(usd ? n * USD_LKR : n);
}

/** "Rise Set" is "Rice set" with a typo, and "Dessert" is the "Desert" this
 *  shop already made — owners type fast. Two characters of slop when matching
 *  a heading against the set names they are allowed to use, so a typo reuses
 *  a name instead of burning one of their three custom slots. */
export function nearName(a, b) {
  const x = String(a || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const y = String(b || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.abs(x.length - y.length) > 2) return false;
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    for (let j = 1; j <= y.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[y.length] <= 2;
}

/** Which catalogue shelf a new dish belongs on, from its name alone. The AI
 *  fills this in properly; this is what stands in when it can't, so a pasted
 *  rice doesn't land under street food and come out of the POS as a Bite. */
export function guessCategory(name) {
  const s = String(name || "").toLowerCase();
  if (/watalappan|wattalappam|cake|pudding|sweet|dessert|ice cream|kavum|kokis|aluwa/.test(s)) return "Sri Lankan Cakes & Sweets";
  if (/\b(rice|bath|biryani|buriyani|kottu|noodle|string hopper|idiyappa|pittu|hopper|appa)\b/.test(s)) return "Rice & Staples";
  if (/chicken|pork|beef|mutton|fish|prawn|shrimp|squid|crab|cuttle|egg|malu|mas\b/.test(s)) return "Meat & Seafood Curries";
  if (/sambol|sambal|salad|mallu|mallum|achcharu|pickle|chutney/.test(s)) return "Salads, Sambols & Relishes";
  if (/roti|paratha|bun|bread|paan|vadai|cutlet|patty|roll/.test(s)) return "Bread, Buns & Beer Snacks";
  if (/curry|kariya|hodi|hoddi|dhal|parippu|polos|kos|bean|beetroot|pumpkin|cabbage|potato|jack|gotukola|leek|carrot|okra|brinjal|cashew/.test(s)) return "Vegetable Curries";
  return "Mixed, Fusion & Street Food";
}

const MENU_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    meal: { type: Type.STRING, description: "Breakfast, Lunch or Dinner if the text names one, else empty" },
    day: { type: Type.STRING, description: "Day of week if named (e.g. Sunday), else empty" },
    groups: {
      type: Type.ARRAY,
      description: "One per heading, in the order written. A menu with no headings has one group named after the meal.",
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "Short set name, 40 chars max. Drop the 'select 04 items' part — that is the pick count." },
          setType: { type: Type.STRING, description: "Exact name from the allowed set types when this heading clearly means one of them, else empty" },
          pick: { type: Type.INTEGER, description: "How many items the buyer chooses from this group. 'select 04 items' = 4. Default 1." },
          priceText: { type: Type.STRING, description: "Price written for the whole set exactly as in the text (e.g. '5$'), else empty" },
          dishes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING, description: "English dish name, cleaned of numbering. Keep the owner's wording." },
                nameSi: { type: Type.STRING, description: "Sinhala name if written, else empty" },
                priceText: { type: Type.STRING, description: "Price written for this dish exactly as in the text, else empty" },
                category: { type: Type.STRING, description: "Best-fitting category from the allowed list" },
                match: { type: Type.STRING, description: "Exact name from the existing catalogue when it is the same dish written the same way, else empty" },
              },
              required: ["name"],
            },
          },
        },
        required: ["name", "dishes"],
      },
    },
    note: { type: Type.STRING, description: "Anything in the text that is not a dish or a heading (e.g. a special-price note), one short line" },
  },
  required: ["groups"],
};

const SYSTEM = `You read a Sri Lankan restaurant's day menu, written informally, and turn it into structured data.

Rules:
- Keep the order and the wording the owner used. Do not invent dishes, do not add dishes that are not written, do not translate an English name into a different dish name.
- A line like "Ponni samba white rice / පොන්නි සම්බා සුදූ බත්" is one dish: name before the slash, Sinhala after it.
- Strip list numbering ("1.", "2.⁠ ⁠") and stray bullet characters from names.
- "Side dishes for select 04 item's" is a group called "Side dishes" with pick = 4.
- A price is written like "5$", "1.00$", "Rs 750", "LKR 750". Put it in priceText exactly as written, on the dish or on the group depending on what it is attached to. Never guess a price that is not written.
- setType: only fill it when the heading clearly means one of the allowed set types (e.g. "Rise Set" means "Rice set", "Meat combo" means "Meat Combo"). Otherwise leave it empty and the shop keeps its own heading.
- match: fill it only when the dish already exists in the catalogue under essentially the same name. If the owner's wording is a different dish, or a distinctly different name, leave it empty — a new catalogue entry will be created for it.
- Marketing lines, greetings, emoji and notes about availability are not dishes. Put them in note.`;

/**
 * @param {string} text        what the owner pasted
 * @param {object} opts
 * @param {string[]} opts.setTypes    set names this shop may use
 * @param {string[]} opts.categories  catalogue category vocabulary
 * @param {string[]} opts.catalogue   existing catalogue dish names
 * @returns {Promise<{ok:boolean, source:string, menu?:object, error?:string}>}
 */
export async function parseMenuText(text, opts = {}) {
  const raw = String(text || "").trim();
  if (!raw) return { ok: false, error: "nothing pasted" };
  if (raw.length > 8000) return { ok: false, error: "that is too long — paste one day's menu" };

  if (!process.env.GEMINI_API_KEY) {
    return { ok: true, source: "rules", menu: rulesParse(raw, opts) };
  }
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const allowed = (opts.setTypes || []).join(", ");
    const cats = (opts.categories || []).join(", ");
    // The catalogue is sent so the model can reuse an existing dish instead of
    // creating a near-duplicate ("Coconut sambal" when "Coconut Sambol" is
    // already there). It is names only — a few thousand tokens.
    const known = (opts.catalogue || []).join(", ");
    const r = await ai.models.generateContent({
      model: "gemini-flash-latest",
      contents: [{
        role: "user",
        parts: [{
          text: `Allowed set types: ${allowed || "(none)"}\n`
            + `Allowed categories: ${cats || "(none)"}\n`
            + `Existing catalogue dishes: ${known || "(none)"}\n\n`
            + `Menu text:\n${raw}`,
        }],
      }],
      config: {
        systemInstruction: SYSTEM,
        responseMimeType: "application/json",
        responseSchema: MENU_SCHEMA,
        temperature: 0,
      },
    });
    const out = r.text || (r.response && r.response.text) || "";
    let parsed;
    try { parsed = JSON.parse(out); } catch { parsed = null; }
    if (!parsed || !Array.isArray(parsed.groups) || !parsed.groups.length) {
      return { ok: true, source: "rules", menu: rulesParse(raw, opts) };
    }
    return { ok: true, source: "ai", menu: normalise(parsed) };
  } catch (e) {
    // A dead key or a spend cap shouldn't mean the owner can't paste.
    return { ok: true, source: "rules", menu: rulesParse(raw, opts), warn: e.message };
  }
}

/** Trim everything to the lengths the plan route accepts. */
function normalise(menu) {
  const groups = (menu.groups || []).slice(0, 12).map((g) => ({
    name: String(g?.name || "").trim().slice(0, 40),
    setType: String(g?.setType || "").trim().slice(0, 40),
    pick: Math.max(1, Math.min(40, Number(g?.pick) || 1)),
    priceText: String(g?.priceText || "").trim().slice(0, 24),
    dishes: (g?.dishes || []).slice(0, 40).map((d) => ({
      name: String(d?.name || "").trim().replace(/\s+/g, " ").slice(0, 80),
      nameSi: String(d?.nameSi || "").trim().slice(0, 120),
      priceText: String(d?.priceText || "").trim().slice(0, 24),
      category: String(d?.category || "").trim().slice(0, 60),
      match: String(d?.match || "").trim().slice(0, 80),
    })).filter((d) => d.name),
  })).filter((g) => g.name && g.dishes.length);
  return {
    meal: String(menu.meal || "").trim(),
    day: String(menu.day || "").trim(),
    note: String(menu.note || "").trim().slice(0, 200),
    groups,
  };
}

/* ---------------------------------------------------------------------------
 * Rules fallback. No AI: a line with a "/" or a number in front is a dish, a
 * short line on its own above dishes is a heading. It gets the common shape
 * right and leaves the owner to fix the rest by hand — which is the point of
 * the editor underneath.
 * ------------------------------------------------------------------------ */
function rulesParse(raw, opts = {}) {
  const setTypes = opts.setTypes || [];
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const groups = [];
  let cur = null;
  const notes = [];

  // A price on the line means it is something being sold, not a heading.
  const hasPrice = (l) => /\d\s*\$|\$\s*\d|(?:rs\.?|lkr)\s*\d/i.test(l);
  const isDishy = (l) => l.includes("/") || /^\d+[.)]/.test(l) || /^[-•*·⁠]/.test(l) || (cur && hasPrice(l));

  const clean = (l) => l.replace(/^[\s\-•*·⁠]*\d*[.)]?\s*/, "").replace(/[⁠​]/g, "").trim();

  for (const line of lines) {
    if (isDishy(line)) {
      if (!cur) { cur = { name: "Menu", setType: "", pick: 1, priceText: "", dishes: [] }; groups.push(cur); }
      const body = clean(line);
      const price = (body.match(/(?:rs\.?|lkr)?\s*\d+(?:\.\d+)?\s*\$|\$\s*\d+(?:\.\d+)?|(?:rs\.?|lkr)\s*\d+(?:[\d,]*)/i) || [""])[0];
      const noPrice = price ? body.replace(price, "").trim() : body;
      const [en, si] = noPrice.split("/");
      // "(Sunday special price)" is a note about the dish, not part of its name.
      const name = (en || "").replace(/\([^)]*\)/g, "").trim();
      if (name) cur.dishes.push({ name: name.slice(0, 80), nameSi: (si || "").trim().slice(0, 120), priceText: price.trim(), category: "", match: "" });
      continue;
    }
    // A heading: short, no sentence punctuation, and it opens a new block.
    if (line.length <= 46 && !/[.!?]$/.test(line)) {
      const pickM = line.match(/(\d+)\s*item/i);
      const name = line.replace(/for\s+select.*$/i, "").replace(/[:\-–]\s*$/, "").trim();
      const hit = setTypes.find((s) => nearName(s, name));
      cur = {
        name: (hit || name).slice(0, 40), setType: hit || "",
        pick: pickM ? Math.max(1, Math.min(40, Number(pickM[1]))) : 1,
        priceText: "", dishes: [],
      };
      groups.push(cur);
      continue;
    }
    notes.push(line);
  }
  return normalise({ meal: "", day: "", note: notes.join(" ").slice(0, 200), groups });
}
