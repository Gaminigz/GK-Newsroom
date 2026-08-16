/**
 * AI-assisted dish recipe generation for shop owners.
 *
 * Given a Sri Lankan dish name (e.g. "Chicken curry"), Gemini returns
 * a per-person ingredient breakdown with typical grams/ml. Prices are
 * cross-referenced against the static ingredient library below.
 *
 * Results are cached in Mongo (`app_dish_recipes` collection) keyed by
 * lowercased dish name to avoid re-hitting Gemini for the same dish.
 */

import { GoogleGenAI, Type } from "@google/genai";
import { LANKA_DISHES_FLAT, LANKA_DISHES_150 } from "../data/lanka-dishes-150.mjs";
import { SPICES } from "../data/spices.ts";

/* -------------------------------------------------------------------------
 * Catalogue-first recipe resolver.
 *
 * The 247-dish catalogue (spices.ts) already carries a 5-person ingredient
 * table for every prepared dish. We resolve recipes from THAT first — it's
 * free, instant, works offline, and dodges the Gemini spend cap entirely.
 * Gemini is only a last resort for dishes not in the catalogue.
 * ---------------------------------------------------------------------- */

const CATALOGUE_BY_NAME = new Map(
  SPICES.filter((s) => Array.isArray(s.ingredients) && s.ingredients.length)
    .map((s) => [s.name.toLowerCase(), s]),
);

/** Parse a "5-person" quantity string ("300 g", "1/2 tsp", "2 sprigs",
 *  "1 medium", "as needed") into { quantity, unit }. Non-numeric amounts
 *  return quantity:null (e.g. "to taste"). */
function parseQty5(qty5) {
  const s = String(qty5 || "").trim().toLowerCase();
  if (!s || /as needed|to taste/.test(s)) return { quantity: null, unit: "" };
  const m = s.match(/^([\d.]+(?:\/\d+)?)\s*(.*)$/);
  if (!m) return { quantity: null, unit: s };
  let num;
  if (m[1].includes("/")) { const [a, b] = m[1].split("/").map(Number); num = b ? a / b : null; }
  else num = parseFloat(m[1]);
  if (num == null || Number.isNaN(num)) return { quantity: null, unit: m[2].trim() };
  return { quantity: num, unit: m[2].trim() };
}

/** Look up a dish in the catalogue and return a per-serving recipe in the
 *  same shape Gemini produces: { servings, ingredients:[{name,quantity,unit,notes}] }.
 *  Returns null if the dish isn't in the catalogue. */
/** The catalogue is written in Sri Lankan names — a shop writes "Chicken
 *  Curry", the recipe book says "Kukul Mas Curry". These are the pairs the
 *  shops' own menus have thrown up; add to it when a dish shows NO RECIPE YET
 *  that plainly has one. */
const RECIPE_ALIAS = {
  "chicken curry": "Kukul Mas Curry",
  "chicken": "Kukul Mas Curry",
  "pork curry": "Black Pork Curry",
  "pork": "Black Pork Curry",
  "beef curry": "Sri Lankan Beef Curry",
  "beef": "Sri Lankan Beef Curry",
  "beef bistake": "Sri Lankan Beef Curry",
  "mutton": "Mutton Curry",
  "dhal curry": "Parippu",
  "dhal": "Parippu",
  "dhal / parippu": "Parippu",
  "coconut sambal": "Pol Sambol",
  "coconut sambol": "Pol Sambol",
  "gotukola salad": "Gotukola and Coconut Salad",
  "gotukola sambol": "Gotukola Sambol",
  "mukunuwenna mellung": "Mukunuwenna Sambol",
  "mellung": "Cabbage Mallung",
  "mallung": "Cabbage Mallung",
  "baby jack curry": "Polos",
  "polos": "Polos",
  "jew plum curry": "Mango Curry",
  "bean": "Green Bean Curry",
  "green bean / bonchi": "Green Bean Curry",
  "muringa curry": "Drumstick Curry",
  "temperate lady finger": "Bandakka Curry",
  "lady finger curry (bandakka)": "Bandakka Curry",
  "temperate dry fish": "Dry Fish Curry",
  "temperate tin fish": "Dry Fish Curry",
  "tin fish salad": "Dry Fish Curry",
  "bitter gourd salad": "Bitter Gourd Curry",
  "spongaud curry": "Luffa Curry",
  "mix vegetables curry": "Mixed Fried Rice",
  "fried papadam and dry chilli": "Papadum Bites",
  "temperate small shrimp": "Prawn Curry",
  "shrimp curry": "Prawn Curry",
  "soya meat curry": "Mushroom Curry",
  "potato curry": "Potato White Curry",
  "temperate potato": "Ala Theldala",
  "basmathi yellow rice": "Yellow Rice and Curry",
  "yellow rice": "Yellow Rice and Curry",
  "fried rice": "Mixed Fried Rice",
  "ponni samba white rice": "Ghee Rice",
  "ponni sambaa white rice": "Ghee Rice",
  "basmathi white rice": "Ghee Rice",
  "ponni sambaa": "Ghee Rice",
  "string hoppers": "String Hoppers with Curry",
  "watalappan": "Watalappam",
};

/** Loose key: lowercase, without the words that decorate a dish name. */
function looseKey(name) {
  return String(name || "").toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/\b(curry|curries|salad|dish|fresh|homemade)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}
const CATALOGUE_BY_LOOSE = new Map(
  SPICES.filter((s) => Array.isArray(s.ingredients) && s.ingredients.length)
    .map((s) => [looseKey(s.name), s]),
);

export function catalogueRecipe(dishName) {
  const raw = String(dishName || "").trim().toLowerCase();
  const alias = RECIPE_ALIAS[raw];
  const s = CATALOGUE_BY_NAME.get(raw)
    || (alias && CATALOGUE_BY_NAME.get(alias.toLowerCase()))
    || CATALOGUE_BY_LOOSE.get(looseKey(dishName));
  if (!s) return null;
  const ingredients = s.ingredients.map((ing) => {
    const { quantity, unit } = parseQty5(ing.qty5);
    // qty5 is for 5 servings → normalise to one serving.
    const perServing = quantity != null ? Math.round((quantity / 5) * 100) / 100 : null;
    return { name: ing.name, nameSi: ing.nameSi || "", quantity: perServing, unit, notes: "" };
  });
  return { servings: 1, ingredients, methodSummary: "" };
}

/** Seed list used to bootstrap the Mongo `lanka_dishes` collection.
 *  At runtime the app should call `loadPresetDishes(col)` to get the
 *  CURRENT list — so if the newsroom adds new dishes to Mongo later,
 *  the app picks them up automatically without a redeploy. */
export const SEED_DISHES = LANKA_DISHES_FLAT;
export { LANKA_DISHES_150 };

/** Load the current preset dish names from Mongo. Falls back to the
 *  in-code seed list if the collection is empty (fresh install). */
export async function loadPresetDishes(lankaDishesCol) {
  try {
    const rows = await lankaDishesCol.find({}, { projection: { name: 1 } }).sort({ order: 1, name: 1 }).toArray();
    if (rows.length) return rows.map((r) => r.name).filter(Boolean);
  } catch { /* Mongo hiccup → fall through to seed */ }
  return SEED_DISHES;
}

/** Ingredient price library — LKR per unit, common Sri Lankan pricing (Aug 2026 base).
 *  Prices are per 100g / 100ml / per piece as noted in `unit`. */
export const INGREDIENT_LIBRARY = {
  // Rice
  "red rice": { lkr: 55, unit: "100g" },
  "white rice": { lkr: 40, unit: "100g" },
  "basmati rice": { lkr: 90, unit: "100g" },
  "samba rice": { lkr: 50, unit: "100g" },
  // Meat & seafood
  "chicken": { lkr: 220, unit: "100g" },
  "beef": { lkr: 380, unit: "100g" },
  "mutton": { lkr: 450, unit: "100g" },
  "pork": { lkr: 300, unit: "100g" },
  "fish (thora)": { lkr: 260, unit: "100g" },
  "fish (kelawalla)": { lkr: 220, unit: "100g" },
  "fish (paraw)": { lkr: 240, unit: "100g" },
  "prawns": { lkr: 400, unit: "100g" },
  "squid": { lkr: 280, unit: "100g" },
  "crab": { lkr: 500, unit: "100g" },
  "egg": { lkr: 40, unit: "1 piece" },
  // Vegetables
  "onion": { lkr: 45, unit: "100g" },
  "tomato": { lkr: 35, unit: "100g" },
  "green chilli": { lkr: 60, unit: "100g" },
  "curry leaves": { lkr: 15, unit: "10g" },
  "garlic": { lkr: 80, unit: "100g" },
  "ginger": { lkr: 90, unit: "100g" },
  "potato": { lkr: 40, unit: "100g" },
  "carrot": { lkr: 55, unit: "100g" },
  "beans": { lkr: 60, unit: "100g" },
  "cabbage": { lkr: 30, unit: "100g" },
  "leeks": { lkr: 60, unit: "100g" },
  "eggplant": { lkr: 50, unit: "100g" },
  "okra": { lkr: 70, unit: "100g" },
  "pumpkin": { lkr: 30, unit: "100g" },
  "jackfruit": { lkr: 45, unit: "100g" },
  // Pulses
  "dhal (mysoor)": { lkr: 50, unit: "100g" },
  "chickpeas": { lkr: 55, unit: "100g" },
  "green gram": { lkr: 60, unit: "100g" },
  "urad dhal": { lkr: 70, unit: "100g" },
  // Coconut & dairy
  "coconut (scraped)": { lkr: 35, unit: "100g" },
  "coconut milk": { lkr: 30, unit: "100ml" },
  "coconut oil": { lkr: 55, unit: "100ml" },
  "curd": { lkr: 45, unit: "100ml" },
  // Spices (per 10g since they're used in small amounts)
  "chilli powder": { lkr: 25, unit: "10g" },
  "turmeric": { lkr: 30, unit: "10g" },
  "black pepper": { lkr: 40, unit: "10g" },
  "cumin": { lkr: 30, unit: "10g" },
  "coriander": { lkr: 25, unit: "10g" },
  "fennel": { lkr: 30, unit: "10g" },
  "fenugreek": { lkr: 25, unit: "10g" },
  "cardamom": { lkr: 90, unit: "10g" },
  "cinnamon": { lkr: 40, unit: "10g" },
  "cloves": { lkr: 80, unit: "10g" },
  "mustard seeds": { lkr: 25, unit: "10g" },
  "curry powder (roasted)": { lkr: 35, unit: "10g" },
  "curry powder (raw)": { lkr: 30, unit: "10g" },
  "goraka (dried)": { lkr: 40, unit: "10g" },
  "pandan leaf": { lkr: 5, unit: "1 piece" },
  "salt": { lkr: 3, unit: "10g" },
  "sugar": { lkr: 12, unit: "10g" },
  // Flour & carbs
  "wheat flour": { lkr: 25, unit: "100g" },
  "rice flour": { lkr: 35, unit: "100g" },
  "roti (godamba)": { lkr: 60, unit: "1 piece" },
  "bread (paan)": { lkr: 15, unit: "1 slice" },
  // Other
  "lime": { lkr: 20, unit: "1 piece" },
  "tamarind": { lkr: 45, unit: "10g" },
  "cashew": { lkr: 200, unit: "10g" },
  "raisins": { lkr: 60, unit: "10g" },
};

const RECIPE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    servings: { type: Type.INTEGER, description: "Number of servings this recipe describes (usually 1)" },
    ingredients: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "Ingredient name, lowercase, matching common Sri Lankan cooking terms" },
          quantity: { type: Type.NUMBER, description: "Numeric amount for ONE serving" },
          unit: { type: Type.STRING, description: "Unit of measure: 'g' (grams), 'ml' (millilitres), or 'piece'" },
          notes: { type: Type.STRING, description: "Optional short note (e.g. 'diced', 'julienned'). Leave empty if not needed." },
        },
        required: ["name", "quantity", "unit"],
      },
    },
    methodSummary: { type: Type.STRING, description: "One-sentence cooking summary" },
  },
  required: ["servings", "ingredients"],
};

const SYSTEM_PROMPT = `You are a Sri Lankan cooking expert. Given a dish name, produce a per-serving ingredient list with typical quantities used in home cooking / small restaurant kitchens in Sri Lanka. Use grams for solids, millilitres for liquids, 'piece' for whole units (egg, lime). Keep ingredient names lowercase and use common Sri Lankan English terms (e.g. "coconut milk", "curry leaves", "dhal", "goraka"). Return ONE serving unless the dish is inherently multi-portion (e.g. a whole biriyani pot).`;

/** Given a dish name, return per-serving ingredient breakdown. Uses cache. */
export async function generateRecipe(dishName, mongoCollection) {
  const key = String(dishName || "").trim().toLowerCase();
  if (!key) return { ok: false, error: "empty dish name" };
  // 1) Mongo cache (best data — real Gemini output with g/ml/piece units).
  try {
    const cached = await mongoCollection.findOne({ _id: key });
    if (cached && cached.recipe) return { ok: true, recipe: cached.recipe, cached: true };
  } catch { /* read hiccup — fall through to catalogue */ }
  // 2) Catalogue (free, instant, offline — covers all prepared dishes).
  const cat = catalogueRecipe(dishName);
  if (cat && cat.ingredients.length) return { ok: true, recipe: cat, cached: true, source: "catalogue" };
  // 3) Gemini — last resort for dishes not in the catalogue.
  if (!process.env.GEMINI_API_KEY) return { ok: false, error: "GEMINI_API_KEY not configured on the server" };
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const r = await ai.models.generateContent({
      model: "gemini-flash-latest",
      contents: [{ role: "user", parts: [{ text: `Dish: ${dishName}` }] }],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: RECIPE_SCHEMA,
      },
    });
    const text = r.text || (r.response && r.response.text) || "";
    let recipe;
    try { recipe = JSON.parse(text); } catch { return { ok: false, error: "AI returned non-JSON" }; }
    if (!recipe || !Array.isArray(recipe.ingredients)) return { ok: false, error: "AI response missing ingredients" };
    // Best-effort cache — ignore write failures (e.g. Mongo storage full).
    try { await mongoCollection.updateOne({ _id: key }, { $set: { _id: key, recipe, updatedAt: new Date() } }, { upsert: true }); } catch { /* non-fatal */ }
    return { ok: true, recipe };
  } catch (e) {
    return { ok: false, error: e.message || "AI call failed" };
  }
}

/** Look up an ingredient in the price library and compute its LKR cost.
 *  Returns { lkr, matched } where matched is the library key used (or null). */
/** Recipes name an ingredient the way a cook would — "Chicken, curry-cut",
 *  "Red onion, minced", "Fresh grated coconut". The price library is keyed on
 *  the plain ingredient. Match on the longest library key the name contains,
 *  so the cut and the preparation don't cost us the price. */
const LIB_KEYS = Object.keys(INGREDIENT_LIBRARY).sort((a, b) => b.length - a.length);
export function libraryKeyFor(name) {
  const s = String(name || "").toLowerCase().replace(/\([^)]*\)/g, " ");
  if (INGREDIENT_LIBRARY[s.trim()]) return s.trim();
  const head = s.split(/[,/]/)[0].trim();
  if (INGREDIENT_LIBRARY[head]) return head;
  for (const k of LIB_KEYS) {
    const bare = k.replace(/\s*\([^)]*\)/, "").trim();
    if (bare.length >= 3 && new RegExp("\\b" + bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "s?\\b").test(s)) return k;
  }
  return "";
}

export function priceIngredient(name, quantity, unit, own = null) {
  // `own` is the shop's own price list. Ingredients cost different money in
  // different countries, so what the owner types always wins over ours.
  const key = libraryKeyFor(name) || String(name || "").toLowerCase().trim();
  const mine = own && (own[key] || own[String(name || "").toLowerCase().trim()]);
  const entry = mine || INGREDIENT_LIBRARY[key];
  if (!entry) return { lkr: null, matched: null };
  const q = Number(quantity);
  // "Salt — to taste" has no quantity. It is not missing a price; it costs
  // next to nothing, so it should not make the whole dish uncostable.
  if (!Number.isFinite(q) || q <= 0) return { lkr: 0, matched: key };

  // Recipes are written the way a cook talks: kg, tbsp, cups, sprigs, "1
  // large". Bring it all to grams, millilitres or pieces before pricing.
  const u = String(unit || "").toLowerCase().trim();
  const SPOON = { tbsp: 15, tablespoon: 15, tsp: 5, teaspoon: 5, cup: 200, cups: 200 };
  const EACH = { sprig: 2, sprigs: 2, clove: 5, cloves: 5, stick: 3, sticks: 3, leaf: 1, leaves: 1, pod: 1, pods: 1 };
  let grams = null, ml = null, pieces = null;
  if (/^kgs?$|^kilo/.test(u)) grams = q * 1000;
  else if (/^g$|^gram/.test(u)) grams = q;
  else if (/^(l|litre|liter)s?$/.test(u)) ml = q * 1000;
  else if (/^ml$|^millilit/.test(u)) ml = q;
  else if (SPOON[u] != null) grams = q * SPOON[u];
  else if (EACH[u] != null) grams = q * EACH[u];
  else if (/piece|pcs?$|whole|large|medium|small|nos?$|^$/.test(u)) pieces = q;

  const per = entry.unit;
  if (grams != null) {
    if (per === "100g") return { lkr: round1((grams / 100) * entry.lkr), matched: key };
    if (per === "10g") return { lkr: round1((grams / 10) * entry.lkr), matched: key };
    if (per === "100ml") return { lkr: round1((grams / 100) * entry.lkr), matched: key };
    if (per === "1 piece") return { lkr: round1(Math.max(1, grams / 50) * entry.lkr), matched: key };
  }
  if (ml != null) {
    if (per === "100ml" || per === "100g") return { lkr: round1((ml / 100) * entry.lkr), matched: key };
    if (per === "10g") return { lkr: round1((ml / 10) * entry.lkr), matched: key };
  }
  if (pieces != null) {
    if (per === "1 piece" || per === "1 slice") return { lkr: round1(pieces * entry.lkr), matched: key };
    // "1 large onion" — about 150 g of it.
    if (per === "100g") return { lkr: round1((pieces * 150 / 100) * entry.lkr), matched: key };
    if (per === "10g") return { lkr: round1((pieces * 10 / 10) * entry.lkr), matched: key };
  }
  return { lkr: null, matched: key }; // known ingredient, unit we can't align
}

function round1(n) { return Math.round(n * 10) / 10; }

