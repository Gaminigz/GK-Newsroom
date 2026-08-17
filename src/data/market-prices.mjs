/**
 * Typical retail prices in Sri Lankan Rupees, one row per item, one column
 * per place we check.
 *
 *   cb     Central Bank daily price report   cbsl.gov.lk
 *   carg   Cargills FoodCity online          cargillsonline.com
 *   arp    Arpico Supercentre                myarpico.com
 *   uber   Keells via UberEats               ubereats.com/lk
 *   app    OURS — the average of whatever the others reported
 *
 * Not every place stocks every item, so a column may be null; `app` averages
 * only the ones that answered. The numbers below are the seed. The newsroom
 * refreshes them **weekly** into the Mongo `market_prices` collection and the
 * app reads that — see NEWSROOM_DISH_RESEARCH.md. Nothing here calls out at
 * request time.
 *
 * `packs` is how the thing is actually sold, so the purchase plan can say
 * "buy 1 × 5 kg bag" instead of "buy 4,000 g".
 */

/** Our price for an item: the average of the places that had it. */
export function appPrice(row) {
  const seen = ["cb", "carg", "arp", "uber"].map((k) => row[k]).filter((n) => Number.isFinite(n) && n > 0);
  if (!seen.length) return Number(row.lkr) || 0;   // seed figure, nobody checked yet
  return Math.round(seen.reduce((a, b) => a + b, 0) / seen.length);
}

export const MARKET_PRICES = [
  // ── Vegi
  { category: "Vegi", name: "Big onion", unit: "kg", lkr: 380, cb: null, carg: null, arp: null, uber: null, packs: "1/5/10 kg net" },
  { category: "Vegi", name: "Red onion", unit: "kg", lkr: 480, cb: null, carg: null, arp: null, uber: null, packs: "1/5/10 kg net" },
  { category: "Vegi", name: "Potato", unit: "kg", lkr: 340, cb: null, carg: null, arp: null, uber: null, packs: "1/5/10 kg net" },
  { category: "Vegi", name: "Carrot", unit: "kg", lkr: 320, cb: null, carg: null, arp: null, uber: null, packs: "500 g/1 kg" },
  { category: "Vegi", name: "Tomato", unit: "kg", lkr: 220, cb: null, carg: null, arp: null, uber: null, packs: "500 g/1 kg" },
  { category: "Vegi", name: "Green chili", unit: "kg", lkr: 620, cb: null, carg: null, arp: null, uber: null, packs: "100/250/500 g" },
  { category: "Vegi", name: "Green beans", unit: "kg", lkr: 340, cb: null, carg: null, arp: null, uber: null, packs: "250/500 g/1 kg" },
  { category: "Vegi", name: "Leeks", unit: "kg", lkr: 260, cb: null, carg: null, arp: null, uber: null, packs: "250/500 g" },
  { category: "Vegi", name: "Cabbage", unit: "kg", lkr: 180, cb: null, carg: null, arp: null, uber: null, packs: "whole/half head" },
  { category: "Vegi", name: "Pumpkin", unit: "kg", lkr: 160, cb: null, carg: null, arp: null, uber: null, packs: "whole/cut kg" },
  { category: "Vegi", name: "Brinjal (Wambatu)", unit: "kg", lkr: 220, cb: null, carg: null, arp: null, uber: null, packs: "250/500 g" },
  { category: "Vegi", name: "Curry leaves", unit: "100g", lkr: 40, cb: null, carg: null, arp: null, uber: null, packs: "25/50 g bunch" },

  // ── Meat & Fish
  { category: "Meat", name: "Chicken (curry cut)", unit: "kg", lkr: 1200, cb: null, carg: null, arp: null, uber: null, packs: "1 kg pack" },
  { category: "Meat", name: "Chicken breast", unit: "kg", lkr: 1400, cb: null, carg: null, arp: null, uber: null, packs: "500 g/1 kg" },
  { category: "Meat", name: "Beef", unit: "kg", lkr: 2600, cb: null, carg: null, arp: null, uber: null, packs: "500 g/1 kg" },
  { category: "Meat", name: "Pork", unit: "kg", lkr: 1800, cb: null, carg: null, arp: null, uber: null, packs: "500 g/1 kg" },
  { category: "Meat", name: "Mutton", unit: "kg", lkr: 3400, cb: null, carg: null, arp: null, uber: null, packs: "500 g/1 kg" },
  { category: "Meat", name: "Fish (Tuna)", unit: "kg", lkr: 1500, cb: null, carg: null, arp: null, uber: null, packs: "500 g/1 kg" },
  { category: "Meat", name: "Fish (Kelawalla)", unit: "kg", lkr: 1300, cb: null, carg: null, arp: null, uber: null, packs: "500 g/1 kg" },
  { category: "Meat", name: "Prawns (medium)", unit: "kg", lkr: 2400, cb: null, carg: null, arp: null, uber: null, packs: "250/500 g" },
  { category: "Meat", name: "Cuttlefish", unit: "kg", lkr: 1900, cb: null, carg: null, arp: null, uber: null, packs: "250/500 g" },
  { category: "Meat", name: "Eggs", unit: "nos", lkr: 55, cb: null, carg: null, arp: null, uber: null, packs: "10/12/30 tray" },

  // ── Dry
  { category: "Dry", name: "Rice (Samba)", unit: "kg", lkr: 240, cb: null, carg: null, arp: null, uber: null, packs: "1/5/10/25 kg bag" },
  { category: "Dry", name: "Rice (Red raw)", unit: "kg", lkr: 210, cb: null, carg: null, arp: null, uber: null, packs: "1/5/10/25 kg bag" },
  { category: "Dry", name: "Rice (Nadu)", unit: "kg", lkr: 220, cb: null, carg: null, arp: null, uber: null, packs: "1/5/10/25 kg bag" },
  { category: "Dry", name: "Red lentils (Parippu)", unit: "kg", lkr: 360, cb: null, carg: null, arp: null, uber: null, packs: "500 g/1 kg" },
  { category: "Dry", name: "Chickpeas", unit: "kg", lkr: 400, cb: null, carg: null, arp: null, uber: null, packs: "500 g/1 kg" },
  { category: "Dry", name: "Green gram (Mung)", unit: "kg", lkr: 480, cb: null, carg: null, arp: null, uber: null, packs: "500 g/1 kg" },
  { category: "Dry", name: "Wheat flour", unit: "kg", lkr: 280, cb: null, carg: null, arp: null, uber: null },
  { category: "Dry", name: "Coconut milk", unit: "400ml pack", lkr: 480, cb: null, carg: null, arp: null, uber: null },
  { category: "Dry", name: "Sugar", unit: "kg", lkr: 340, cb: null, carg: null, arp: null, uber: null },
  { category: "Dry", name: "Salt", unit: "kg", lkr: 90, cb: null, carg: null, arp: null, uber: null },
  { category: "Dry", name: "Coconut oil", unit: "L", lkr: 890, cb: null, carg: null, arp: null, uber: null },
  { category: "Dry", name: "Coconut (whole)", unit: "nos", lkr: 180, cb: null, carg: null, arp: null, uber: null },

  // ── Spices
  { category: "Spices", name: "Turmeric powder", unit: "kg", lkr: 1200, cb: null, carg: null, arp: null, uber: null },
  { category: "Spices", name: "Chili powder", unit: "kg", lkr: 1500, cb: null, carg: null, arp: null, uber: null },
  { category: "Spices", name: "Curry powder (roasted)", unit: "kg", lkr: 1200, cb: null, carg: null, arp: null, uber: null },
  { category: "Spices", name: "Cardamom", unit: "kg", lkr: 22000, cb: null, carg: null, arp: null, uber: null },
  { category: "Spices", name: "Cinnamon", unit: "kg", lkr: 4200, cb: null, carg: null, arp: null, uber: null },
  { category: "Spices", name: "Cumin seeds", unit: "kg", lkr: 2400, cb: null, carg: null, arp: null, uber: null },
  { category: "Spices", name: "Black pepper", unit: "kg", lkr: 6800, cb: null, carg: null, arp: null, uber: null },
  { category: "Spices", name: "Coriander seeds", unit: "kg", lkr: 1400, cb: null, carg: null, arp: null, uber: null },
  { category: "Spices", name: "Mustard seeds", unit: "kg", lkr: 900, cb: null, carg: null, arp: null, uber: null },
  { category: "Spices", name: "Ginger", unit: "kg", lkr: 1200, cb: null, carg: null, arp: null, uber: null },
  { category: "Spices", name: "Garlic", unit: "kg", lkr: 1400, cb: null, carg: null, arp: null, uber: null },
  { category: "Spices", name: "Tamarind", unit: "kg", lkr: 1200, cb: null, carg: null, arp: null, uber: null },
];

export const MARKET_CATEGORIES = ["Vegi", "Meat", "Dry", "Spices"];
