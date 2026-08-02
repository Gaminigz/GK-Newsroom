/**
 * Sri Lankan bakery & canteen classics + cakes/sweets — ~40 items.
 * Two groups: bakery/canteen items (buns, pastries, rolls) and traditional
 * sweets (kavum, dodol, watalappam, etc.).
 *
 * Seeded to Mongo `lanka_bakery` by src/scripts/seed-lanka-recipes.mjs.
 * The newsroom pipeline reads from that collection to generate feed posts
 * (image + copy + audio) at ~10–15 items/day to stay under Gemini free-tier
 * daily limits. Meanwhile the iOS/Android apps can immediately show the
 * list of topics — enrichment fills in over time.
 */

export const LANKA_BAKERY = {
  "Bakery & Canteen Classics": {
    si: "බේකරි සහ කැන්ටින් නිෂ්පාදන",
    items: [
      { name: "Fish Bun", si: "මාළු බනිස්" },
      { name: "Egg Bun", si: "බිත්තර බනිස්" },
      { name: "Sausage Bun", si: "සොසේජස් බනිස්" },
      { name: "Seeni Sambol Bun", si: "සීනි සම්බෝල බනිස්" },
      { name: "Jam Bun", si: "ජෑම් බනිස්" },
      { name: "Cream Bun", si: "ක්‍රීම් බනිස්" },
      { name: "Coconut Bun / Ceylon Bun", si: "පොල් බනිස්" },
      { name: "Fish Pastry", si: "මාළු පැස්ට්‍රි" },
      { name: "Chicken Pastry", si: "චිකන් පැස්ට්‍රි" },
      { name: "Fish Cutlet", si: "මාළු කට්ලට්" },
      { name: "Egg Roll", si: "බිත්තර රෝල්ස්" },
      { name: "Chicken Roll", si: "චිකන් රෝල්ස්" },
      { name: "Mutton Roll", si: "එළු මස් රෝල්ස්" },
      { name: "Chicken Patties", si: "චිකන් පැටිස්" },
      { name: "Vegetable Roti", si: "එළවළු රොටි" },
      { name: "Egg Roti", si: "බිත්තර රොටි" },
      { name: "Bread Loaf", si: "සාමාන්‍ය බේකරි පාන්" },
      { name: "Bun With Butter & Sugar", si: "බටර් සහ සීනි ගාපු බනිස්" },
      { name: "Sausage Roll", si: "සොසේජස් රෝල්" },
      { name: "Cheese Pastry", si: "චීස් පැස්ට්‍රි" },
    ],
  },
  "Sri Lankan Cakes & Sweets": {
    si: "කේක් සහ වෙනත් රසකැවිලි",
    items: [
      { name: "Sri Lankan Butter Cake", si: "බටර් කේක්" },
      { name: "Ribbon Cake", si: "රිබන් කේක්" },
      { name: "Love Cake", si: "ලව් කේක්" },
      { name: "Chocolate Biscuits Pudding", si: "බිස්කට් පුඩිං" },
      { name: "Watalappam", si: "වටලප්පන්" },
      { name: "Caramel Pudding", si: "කැරමල් පුඩිං" },
      { name: "Aluwa", si: "අලුවා" },
      { name: "Dodol", si: "දොඩෝල්" },
      { name: "Thala Guli", si: "තල ගුලි" },
      { name: "Kalu Dodol", si: "කළු දොඩෝල්" },
      { name: "Peni Walalu", si: "පැණි වළලු" },
      { name: "Asmi", si: "අස්මි" },
      { name: "Kokis", si: "කොකිස්" },
      { name: "Kewum / Kavum", si: "කැවුම්" },
      { name: "Konda Kavum", si: "කොණ්ඩා කැවුම්" },
      { name: "Athirasa", si: "අතිරස" },
      { name: "Mung Kavum", si: "මුං කැවුම්" },
      { name: "Naran Kavum", si: "නාරං කැවුම්" },
      { name: "Surul Kavum", si: "සුරුල් කැවුම්" },
      { name: "Undu Wel", si: "උළුඳු වැල්" },
    ],
  },
};

export const LANKA_BAKERY_FLAT_ENTRIES = Object.entries(LANKA_BAKERY).flatMap(
  ([category, { items }]) => items.map((b) => ({ ...b, category })),
);

export const LANKA_BAKERY_FLAT = LANKA_BAKERY_FLAT_ENTRIES.map((b) => b.name);

export const LANKA_BAKERY_COUNT = LANKA_BAKERY_FLAT.length;
