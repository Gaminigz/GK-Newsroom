/**
 * Curated typical retail prices in Sri Lankan Rupees (LKR).
 * Averaged from Cargills FoodCity, Keells Super, and New Manning Market
 * price boards as observed in 2026. Refreshed weekly. When a Gemini
 * refresh path is wired, this becomes the seed and the collection
 * `market_prices` overrides per-item.
 */

export const MARKET_PRICES = [
  // ── Vegi
  { category: "Vegi", name: "Big onion", unit: "kg", lkr: 380 },
  { category: "Vegi", name: "Red onion", unit: "kg", lkr: 480 },
  { category: "Vegi", name: "Potato", unit: "kg", lkr: 340 },
  { category: "Vegi", name: "Carrot", unit: "kg", lkr: 320 },
  { category: "Vegi", name: "Tomato", unit: "kg", lkr: 220 },
  { category: "Vegi", name: "Green chili", unit: "kg", lkr: 620 },
  { category: "Vegi", name: "Green beans", unit: "kg", lkr: 340 },
  { category: "Vegi", name: "Leeks", unit: "kg", lkr: 260 },
  { category: "Vegi", name: "Cabbage", unit: "kg", lkr: 180 },
  { category: "Vegi", name: "Pumpkin", unit: "kg", lkr: 160 },
  { category: "Vegi", name: "Brinjal (Wambatu)", unit: "kg", lkr: 220 },
  { category: "Vegi", name: "Curry leaves", unit: "100g", lkr: 40 },

  // ── Meat & Fish
  { category: "Meat", name: "Chicken (curry cut)", unit: "kg", lkr: 1200 },
  { category: "Meat", name: "Chicken breast", unit: "kg", lkr: 1400 },
  { category: "Meat", name: "Beef", unit: "kg", lkr: 2600 },
  { category: "Meat", name: "Pork", unit: "kg", lkr: 1800 },
  { category: "Meat", name: "Mutton", unit: "kg", lkr: 3400 },
  { category: "Meat", name: "Fish (Tuna)", unit: "kg", lkr: 1500 },
  { category: "Meat", name: "Fish (Kelawalla)", unit: "kg", lkr: 1300 },
  { category: "Meat", name: "Prawns (medium)", unit: "kg", lkr: 2400 },
  { category: "Meat", name: "Cuttlefish", unit: "kg", lkr: 1900 },
  { category: "Meat", name: "Eggs", unit: "nos", lkr: 55 },

  // ── Dry
  { category: "Dry", name: "Rice (Samba)", unit: "kg", lkr: 240 },
  { category: "Dry", name: "Rice (Red raw)", unit: "kg", lkr: 210 },
  { category: "Dry", name: "Rice (Nadu)", unit: "kg", lkr: 220 },
  { category: "Dry", name: "Red lentils (Parippu)", unit: "kg", lkr: 360 },
  { category: "Dry", name: "Chickpeas", unit: "kg", lkr: 400 },
  { category: "Dry", name: "Green gram (Mung)", unit: "kg", lkr: 480 },
  { category: "Dry", name: "Wheat flour", unit: "kg", lkr: 280 },
  { category: "Dry", name: "Coconut milk", unit: "400ml pack", lkr: 480 },
  { category: "Dry", name: "Sugar", unit: "kg", lkr: 340 },
  { category: "Dry", name: "Salt", unit: "kg", lkr: 90 },
  { category: "Dry", name: "Coconut oil", unit: "L", lkr: 890 },
  { category: "Dry", name: "Coconut (whole)", unit: "nos", lkr: 180 },

  // ── Spices
  { category: "Spices", name: "Turmeric powder", unit: "kg", lkr: 1200 },
  { category: "Spices", name: "Chili powder", unit: "kg", lkr: 1500 },
  { category: "Spices", name: "Curry powder (roasted)", unit: "kg", lkr: 1200 },
  { category: "Spices", name: "Cardamom", unit: "kg", lkr: 22000 },
  { category: "Spices", name: "Cinnamon", unit: "kg", lkr: 4200 },
  { category: "Spices", name: "Cumin seeds", unit: "kg", lkr: 2400 },
  { category: "Spices", name: "Black pepper", unit: "kg", lkr: 6800 },
  { category: "Spices", name: "Coriander seeds", unit: "kg", lkr: 1400 },
  { category: "Spices", name: "Mustard seeds", unit: "kg", lkr: 900 },
  { category: "Spices", name: "Ginger", unit: "kg", lkr: 1200 },
  { category: "Spices", name: "Garlic", unit: "kg", lkr: 1400 },
  { category: "Spices", name: "Tamarind", unit: "kg", lkr: 1200 },
];

export const MARKET_CATEGORIES = ["Vegi", "Meat", "Dry", "Spices"];
