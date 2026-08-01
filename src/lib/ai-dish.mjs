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

/** Curated preset dish names — powers the search datalist. */
export const PRESET_DISHES = [
  "Chicken curry", "Beef curry", "Pork curry", "Mutton curry", "Fish curry (thora)",
  "Fish ambulthiyal", "Prawn curry", "Squid curry", "Crab curry", "Dhal curry (parippu)",
  "Coconut sambol (pol sambol)", "Seeni sambol", "Lunu miris", "Katta sambol",
  "Kottu roti (chicken)", "Kottu roti (cheese)", "Kottu roti (vegetable)", "Kottu roti (egg)",
  "Egg hoppers (bittara appa)", "Milk hoppers", "String hoppers (idiyappam)", "Plain hoppers",
  "Rice & curry (fish)", "Rice & curry (chicken)", "Rice & curry (vegetable)", "Rice & curry (beef)",
  "Fried rice (chicken)", "Fried rice (egg)", "Fried rice (seafood)", "Nasi goreng (Sri Lankan style)",
  "Watalappan", "Kavum", "Kokis", "Aluwa", "Milk toffee", "Curd & treacle",
  "Kiribath (milk rice)", "Pittu", "Pol roti (coconut roti)", "Godamba roti", "Egg roti",
  "Parippu vadai", "Isso vadai", "Ulundu vadai", "Cutlets (fish)", "Cutlets (chicken)",
  "Devilled chicken", "Devilled prawns", "Devilled beef", "Devilled squid",
  "Chicken biriyani", "Mutton biriyani", "Egg biriyani", "Vegetable biriyani",
  "Jaffna crab curry", "Kool (Jaffna seafood soup)", "Ala thel dala (tempered potato)",
  "Karola (mixed vegetable curry)", "Ambul kelawalla (sour tuna)", "Roast paan", "Faluda",
  "Wambatu moju (eggplant pickle)", "Gotu kola sambol", "Mallum (kale)",
];

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
  const cached = await mongoCollection.findOne({ _id: key });
  if (cached && cached.recipe) return { ok: true, recipe: cached.recipe, cached: true };
  if (!process.env.GEMINI_API_KEY) return { ok: false, error: "GEMINI_API_KEY not configured on the server" };
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const r = await ai.models.generateContent({
      model: "gemini-2.5-flash",
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
    await mongoCollection.updateOne({ _id: key }, { $set: { _id: key, recipe, updatedAt: new Date() } }, { upsert: true });
    return { ok: true, recipe };
  } catch (e) {
    return { ok: false, error: e.message || "AI call failed" };
  }
}

/** Look up an ingredient in the price library and compute its LKR cost.
 *  Returns { lkr, matched } where matched is the library key used (or null). */
export function priceIngredient(name, quantity, unit) {
  const key = String(name || "").toLowerCase().trim();
  const entry = INGREDIENT_LIBRARY[key];
  if (!entry) return { lkr: null, matched: null };
  const q = Number(quantity) || 0;
  const u = String(unit || "").toLowerCase();
  // Normalise so we compare like-for-like against entry.unit.
  const unitMatch = (a, b) => a === b || (a === "g" && b === "100g") || (a === "ml" && b === "100ml") || (a === "piece" && b === "1 piece");
  if (u === "g" && entry.unit === "100g") return { lkr: Math.round((q / 100) * entry.lkr * 10) / 10, matched: key };
  if (u === "ml" && entry.unit === "100ml") return { lkr: Math.round((q / 100) * entry.lkr * 10) / 10, matched: key };
  if (u === "g" && entry.unit === "10g") return { lkr: Math.round((q / 10) * entry.lkr * 10) / 10, matched: key };
  if (u === "piece" && entry.unit === "1 piece") return { lkr: Math.round(q * entry.lkr * 10) / 10, matched: key };
  if (unitMatch(u, entry.unit)) return { lkr: Math.round(q * entry.lkr * 10) / 10, matched: key };
  return { lkr: null, matched: key }; // matched name but couldn't align units
}
