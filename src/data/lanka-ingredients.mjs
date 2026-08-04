/**
 * Sri Lankan kitchen ingredient catalogue, grouped into the four stock
 * categories the app's Kitchen Stock screen uses: Vegi / Meat / Dry /
 * Spices. Each entry carries a Sinhala name and a sensible default unit
 * so the shop owner's "add to stock" dropdown pre-fills the right unit.
 *
 * Units: kg | L | pcs | packs — matching the Kitchen Stock UI's unit
 * picker. Owners can override the unit per item when they add it.
 *
 * This is the source list for the category dropdowns; the actual per-shop
 * stock lives in Mongo `kitchen_stock` (one doc per shop+ingredient).
 */

export const LANKA_INGREDIENTS = {
  Vegi: {
    label: "Vegetables & Fresh",
    labelSi: "එළවළු",
    items: [
      { name: "Big Onion", si: "බී ලූනු", unit: "kg" },
      { name: "Red Onion (Shallot)", si: "රතු ලූනු", unit: "kg" },
      { name: "Tomato", si: "තක්කාලි", unit: "kg" },
      { name: "Potato", si: "අර්තාපල්", unit: "kg" },
      { name: "Carrot", si: "කැරට්", unit: "kg" },
      { name: "Green Beans", si: "බෝංචි", unit: "kg" },
      { name: "Cabbage", si: "ගෝවා", unit: "kg" },
      { name: "Leeks", si: "ලීක්ස්", unit: "kg" },
      { name: "Brinjal (Eggplant)", si: "වම්බටු", unit: "kg" },
      { name: "Okra (Bandakka)", si: "බණ්ඩක්කා", unit: "kg" },
      { name: "Pumpkin", si: "වට්ටක්කා", unit: "kg" },
      { name: "Snake Gourd", si: "පතෝල", unit: "kg" },
      { name: "Bitter Gourd", si: "කරවිල", unit: "kg" },
      { name: "Drumstick", si: "මුරුංගා", unit: "kg" },
      { name: "Radish", si: "රාබු", unit: "kg" },
      { name: "Beetroot", si: "බීට්‌රූට්", unit: "kg" },
      { name: "Ash Plantain", si: "අළු කෙසෙල්", unit: "kg" },
      { name: "Capsicum", si: "මාළු මිරිස්", unit: "kg" },
      { name: "Green Chili", si: "අමු මිරිස්", unit: "kg" },
      { name: "Curry Leaves", si: "කරපිංචා", unit: "packs" },
      { name: "Pandan (Rampe)", si: "රම්පේ", unit: "packs" },
      { name: "Ginger", si: "ඉඟුරු", unit: "kg" },
      { name: "Garlic", si: "සුදු ලූනු", unit: "kg" },
      { name: "Lime", si: "දෙහි", unit: "pcs" },
      { name: "Coconut", si: "පොල්", unit: "pcs" },
      { name: "Mushroom", si: "බිම්මල්", unit: "kg" },
      { name: "Gotukola", si: "ගොටුකොළ", unit: "packs" },
      { name: "Mukunuwenna", si: "මුකුණුවැන්න", unit: "packs" },
      { name: "Kangkung", si: "කංකුං", unit: "packs" },
      { name: "Jackfruit (Polos)", si: "පොලොස්", unit: "kg" },
    ],
  },
  Meat: {
    label: "Meat & Seafood",
    labelSi: "මස් හා මාළු",
    items: [
      { name: "Chicken (curry cut)", si: "කුකුළු මස්", unit: "kg" },
      { name: "Beef", si: "හරක් මස්", unit: "kg" },
      { name: "Pork", si: "ඌරු මස්", unit: "kg" },
      { name: "Mutton", si: "එළු මස්", unit: "kg" },
      { name: "Fish (Thora)", si: "තෝර මාළු", unit: "kg" },
      { name: "Fish (Kelawalla)", si: "කෙළවල්ලා", unit: "kg" },
      { name: "Fish (Paraw)", si: "පරෝ මාළු", unit: "kg" },
      { name: "Prawns", si: "ඉස්සන්", unit: "kg" },
      { name: "Cuttlefish / Squid", si: "දැල්ලෝ", unit: "kg" },
      { name: "Crab", si: "කකුළුවෝ", unit: "kg" },
      { name: "Dry Fish", si: "කරවල", unit: "kg" },
      { name: "Sprats (Halmessa)", si: "හාල්මැස්සෝ", unit: "kg" },
      { name: "Egg", si: "බිත්තර", unit: "pcs" },
      { name: "Sausages", si: "සොසේජස්", unit: "packs" },
      { name: "Chicken Liver", si: "කුකුළු අක්මාව", unit: "kg" },
    ],
  },
  Dry: {
    label: "Dry Goods & Grains",
    labelSi: "වියළි ද්‍රව්‍ය",
    items: [
      { name: "Red Rice", si: "රතු හාල්", unit: "kg" },
      { name: "White Rice", si: "සුදු හාල්", unit: "kg" },
      { name: "Samba Rice", si: "සම්බා හාල්", unit: "kg" },
      { name: "Basmati Rice", si: "බාස්මතී හාල්", unit: "kg" },
      { name: "Wheat Flour", si: "තිරිඟු පිටි", unit: "kg" },
      { name: "Rice Flour", si: "හාල් පිටි", unit: "kg" },
      { name: "Red Dhal (Parippu)", si: "පරිප්පු", unit: "kg" },
      { name: "Chickpeas (Kadala)", si: "කඩල", unit: "kg" },
      { name: "Green Gram (Mung)", si: "මුං ඇට", unit: "kg" },
      { name: "Urad Dal (Ulundu)", si: "උළුඳු", unit: "kg" },
      { name: "Coconut Milk (canned)", si: "පොල් කිරි ටින්", unit: "packs" },
      { name: "Coconut Milk Powder", si: "පොල් කිරි කුඩු", unit: "packs" },
      { name: "Coconut Oil", si: "පොල් තෙල්", unit: "L" },
      { name: "Cooking Oil", si: "පිසින තෙල්", unit: "L" },
      { name: "Sugar", si: "සීනි", unit: "kg" },
      { name: "Salt", si: "ලුණු", unit: "kg" },
      { name: "Noodles", si: "නූඩ්ල්ස්", unit: "packs" },
      { name: "Bread", si: "පාන්", unit: "pcs" },
      { name: "Papadum", si: "පප්පඩම්", unit: "packs" },
      { name: "Cashew", si: "කජු", unit: "kg" },
      { name: "Kithul Treacle", si: "කිතුල් පැණි", unit: "L" },
    ],
  },
  Spices: {
    label: "Spices & Seasoning",
    labelSi: "කුළුබඩු",
    items: [
      { name: "Roasted Curry Powder", si: "බැදපු තුනපහ", unit: "packs" },
      { name: "Raw Curry Powder", si: "අමු තුනපහ", unit: "packs" },
      { name: "Chili Powder", si: "මිරිස් කුඩු", unit: "kg" },
      { name: "Chili Flakes", si: "මිරිස් කෑලි", unit: "kg" },
      { name: "Turmeric Powder", si: "කහ කුඩු", unit: "packs" },
      { name: "Black Pepper", si: "ගම්මිරිස්", unit: "kg" },
      { name: "Cumin (Suduru)", si: "සූදුරු", unit: "packs" },
      { name: "Coriander (Kottamalli)", si: "කොත්තමල්ලි", unit: "packs" },
      { name: "Fennel (Maduru)", si: "මාදුරු", unit: "packs" },
      { name: "Fenugreek (Uluhal)", si: "උළුහාල්", unit: "packs" },
      { name: "Cardamom (Enasal)", si: "එනසාල්", unit: "packs" },
      { name: "Cinnamon (Kurundu)", si: "කුරුඳු", unit: "packs" },
      { name: "Cloves (Karabu Nati)", si: "කරාබුනැටි", unit: "packs" },
      { name: "Mustard Seeds", si: "අබ", unit: "packs" },
      { name: "Goraka", si: "ගොරකා", unit: "packs" },
      { name: "Tamarind", si: "සියඹලා", unit: "packs" },
      { name: "Maldive Fish (Umbalakada)", si: "උම්බලකඩ", unit: "packs" },
    ],
  },
};

/** Ordered category keys for the stock tabs. */
export const INGREDIENT_CATEGORIES = Object.keys(LANKA_INGREDIENTS);

/** Valid stock units (the UI's unit picker). */
export const STOCK_UNITS = ["kg", "L", "packs", "pcs"];

/** Flat lookup: lowercased name → { category, si, unit }. */
export const INGREDIENT_INDEX = (() => {
  const idx = {};
  for (const [category, { items }] of Object.entries(LANKA_INGREDIENTS)) {
    for (const it of items) idx[it.name.toLowerCase()] = { ...it, category };
  }
  return idx;
})();
