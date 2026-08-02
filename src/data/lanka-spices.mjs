/**
 * Sri Lankan spices and aromatics catalogue — ~48 items across 4 groups.
 * Powers the 3una5aha newsroom "Sri Lankan Spices" channel (existing
 * feed, currently at 24 posts with each spice getting its own post +
 * short description + audio).
 *
 * Seeded to Mongo `lanka_spices` by src/scripts/seed-lanka-recipes.mjs.
 * The newsroom pipeline reads from that collection to generate feed
 * posts (image + copy + audio) for each spice, respecting Gemini
 * free-tier daily limits via the daily cron.
 */

export const LANKA_SPICES = {
  "Fresh Spices & Aromatics": {
    si: "අලුත් කුළුබඩු සහ සුවඳකාරක",
    items: [
      { name: "Fresh Ginger Root", si: "අලුත් ඉඟුරු අල" },
      { name: "Garlic Cloves", si: "සුදු ලූනු බිළිඳ" },
      { name: "Shallots (Small Red Onions)", si: "සාලු හෝ රතු ලූනු" },
      { name: "Big Red / White Onions", si: "බොම්බායි ලූනු / රතු සහ සුදු ලූනු" },
      { name: "Green Chilies", si: "අමු මිරිස්" },
      { name: "Bird's Eye Chilies (Kochchi Miris)", si: "කොච්චි මිරිස්" },
      { name: "Curry Leaves (Karapincha)", si: "කරපිංචා" },
      { name: "Pandan Leaves (Rampe)", si: "රම්පේ" },
      { name: "Lemongrass Stalks", si: "සේර" },
      { name: "Fresh Turmeric Root", si: "අලුත් කහ අල" },
      { name: "Raw Green Mango", si: "අමු අඹ" },
      { name: "Goraka (Fresh Malabar Tamarind pieces)", si: "ගොරකා" },
    ],
  },
  "Dried Whole Spices": {
    si: "වියළි මුල් කුළුබඩු",
    items: [
      { name: "Dry Red Chilies (Whole)", si: "වියළි මිරිස්" },
      { name: "Black Peppercorns", si: "ගම්මිරිස් ඇට" },
      { name: "Coriander Seeds (Whole)", si: "කොත්තමල්ලි ඇට" },
      { name: "Cumin Seeds (Jeera)", si: "දුරු" },
      { name: "Fennel Seeds (Mahenduru)", si: "මහදුරු" },
      { name: "Fenugreek Seeds (Uluhal)", si: "උළුහාල්" },
      { name: "Mustard Seeds (Bada Ithuru)", si: "අබ ඇට" },
      { name: "Green Cardamom Pods", si: "කරදමුංගු" },
      { name: "Black Cardamom", si: "කළු කරදමුංගු" },
      { name: "Cloves (Karabu Nati)", si: "කරාබුනැටි" },
      { name: "Cinnamon Sticks / Quills (Kurundu)", si: "කුරුඳු පොතු" },
      { name: "Nutmeg Whole", si: "සාදික්කා" },
      { name: "Mace (Jathi Paththri)", si: "ජාවත්‍රී" },
      { name: "Star Anise", si: "තාරකා මල් / චීන අනිස්" },
      { name: "Curry Leaves (Dried)", si: "වියළි කරපිංචා" },
    ],
  },
  "Powdered Spices & Blends": {
    si: "කුඩු කළ කුළුබඩු සහ මිශ්‍රණ",
    items: [
      { name: "Sri Lankan Roasted Curry Powder", si: "බදින ලද තුනපහ කුඩු" },
      { name: "Sri Lankan Unroasted Curry Powder", si: "බැද නොගත් තුනපහ කුඩු" },
      { name: "Jaffna Special Curry Powder", si: "යාපනය විශේෂ කුඩු" },
      { name: "Chili Powder (Standard / Hot)", si: "මිරිස් කුඩු" },
      { name: "Chili Flakes", si: "මිරිස් කෑලි" },
      { name: "Turmeric Powder", si: "කහ කුඩු" },
      { name: "Black Pepper Powder", si: "ගම්මිරිස් කුඩු" },
      { name: "Cumin Powder", si: "දුරු කුඩු" },
      { name: "Coriander Powder", si: "කොත්තමල්ලි කුඩු" },
      { name: "Fenugreek Powder", si: "උළුහාල් කුඩු" },
      { name: "Cinnamon Powder", si: "කුරුඳු කුඩු" },
      { name: "Nutmeg Powder", si: "සාදික්කා කුඩු" },
      { name: "Garam Masala", si: "ගරම් මසාලා" },
    ],
  },
  "Pre-Processed & Specialty Spice Pastes / Items": {
    si: "කල් තබාගත් සහ විශේෂ කුළුබඩු පේස්ට් / ද්‍රව්‍ය",
    items: [
      { name: "Goraka Paste", si: "ගොරකා පේස්ට්" },
      { name: "Tamarind Pulp / Concentrate", si: "සියඹලා මදය / සියඹලා යුෂ" },
      { name: "Roasted Maldive Fish Chips & Powder", si: "මෝල්දිව් මාළු (උම්බලකඩ) කැබලි සහ කුඩු" },
      { name: "Roasted Mustard Paste", si: "බදින ලද අබ පේස්ට්" },
      { name: "Ginger-Garlic Paste", si: "ඉඟුරු-සුදු ලූනු පේස්ට්" },
      { name: "Fermented Coconut Toddy", si: "පැසුණු පොල් රා" },
      { name: "Sesame Seeds (White and Black)", si: "තල ඇට - සුදු සහ කළු" },
      { name: "Poppy Seeds (Kasa Kasa)", si: "කසාකසා" },
    ],
  },
};

/** Flat list of all spice entries (name + si + category). */
export const LANKA_SPICES_FLAT_ENTRIES = Object.entries(LANKA_SPICES).flatMap(
  ([category, { items }]) => items.map((s) => ({ ...s, category })),
);

/** Flat list of just the English spice names. */
export const LANKA_SPICES_FLAT = LANKA_SPICES_FLAT_ENTRIES.map((s) => s.name);

/** Total count. */
export const LANKA_SPICES_COUNT = LANKA_SPICES_FLAT.length;
