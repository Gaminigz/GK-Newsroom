/**
 * 150 curated Sri Lankan dishes, categorised, with English + Sinhala names.
 * Sourced from the 3una 5aha newsroom-side catalogue.
 *
 * The app's Plan Menu picker pulls names from Mongo `lanka_dishes`
 * (seeded from this file). The daily cron (`npm run daily:lanka`)
 * pre-generates per-serving ingredient recipes via Gemini and caches
 * them in Mongo `app_dish_recipes` so the app never hits the AI at
 * runtime for these dishes.
 *
 * Six categories, ~25 dishes each = 150.
 *
 * Note: some dish names appear in more than one category (e.g. "Fish Bun"
 * lives in both "Mixed, Fusion & Street Food" and "Bread, Buns &
 * Beer Snacks"). The seed script's Mongo upsert by lowercased name means
 * the LATER category wins in `lanka_dishes.category`. This is fine —
 * duplicates are the newsroom's editorial choice, and one dish record
 * per unique dish name is what the app needs.
 */

export const LANKA_DISHES_150 = {
  "Vegetable Curries": {
    si: "පළතුරු හා අලුත් බෝග කරවල",
    dishes: [
      { name: "Parippu", si: "පරිප්පු කරවල" },
      { name: "Polos", si: "පොලොස් කරවල" },
      { name: "Kiri Kos", si: "කිරි කොස්" },
      { name: "Potato White Curry", si: "අර්තාපල් කිරි හොදි" },
      { name: "Pumpkin Curry", si: "වට්ටක්කා කරවල" },
      { name: "Beetroot Curry", si: "බීට්‌රූට් කරවල" },
      { name: "Cabbage Curry", si: "ගෝවා කරවල" },
      { name: "Bandakka Curry", si: "බණ්ඩක්කා කරවල" },
      { name: "Drumstick Curry", si: "මුරුනගා කරවල" },
      { name: "Snake Gourd Curry", si: "පතෝල කරවල" },
      { name: "Radish Curry", si: "මුලී කරවල" },
      { name: "Cashew Nut Curry", si: "කජු කරවල" },
      { name: "Mango Curry", si: "අඹ කරවල" },
      { name: "Pineapple Curry", si: "අනනස් කරවල" },
      { name: "Ash Plantain Curry", si: "අළු කෙසෙල් කරවල" },
      { name: "Tomato Curry", si: "තක්කාලි කරවල" },
      { name: "Green Bean Curry", si: "බෝංචි කරවල" },
      { name: "Bitter Gourd Curry", si: "කරවිල කරවල" },
      { name: "Knol Khol Curry", si: "නෝකෝල් කරවල" },
      { name: "Mushroom Curry", si: "බිම්මල් කරවල" },
      { name: "Brinjal Curry", si: "වම්බටු කරවල" },
      { name: "Luffa Curry", si: "වැටකොළු කරවල" },
      { name: "Lotus Root Curry", si: "නෙළුම් අල කරවල" },
      { name: "Breadfruit Curry", si: "දෙල් කරවල" },
      { name: "Ripe Jackfruit Curry", si: "වැල් කොස් කරවල" },
    ],
  },
  "Meat & Seafood Curries": {
    si: "මස් හා මාළු කරවල",
    dishes: [
      { name: "Kukul Mas Curry", si: "කුකුළු මස් කරවල" },
      { name: "Black Pork Curry", si: "කළුඌරු මස් කරවල" },
      { name: "Mutton Curry", si: "එළු මස් කරවල" },
      { name: "Sri Lankan Beef Curry", si: "හරක් මස් කරවල" },
      { name: "Jaffna Mutton Kuzhambu", si: "යාපනය එළු මස් හොදි" },
      { name: "Malu Mirisata", si: "මාළු මිරිසට" },
      { name: "Kiri Hodi Malu", si: "මාළු කිරි හොදි" },
      { name: "Prawn Curry", si: "ඉස්සන් කරවල" },
      { name: "Cuttlefish Curry", si: "දැල්ලා කරවල" },
      { name: "Crab Curry", si: "කකුළු කරවල" },
      { name: "Dry Fish Curry", si: "කරවල හොද්ද" },
      { name: "Ambul Thiyal", si: "මාළු ඇඹුල් තියල්" },
      { name: "Fish Ambul Thiyal", si: "මාළු ඇඹුල් තියල්" },
      { name: "Shark Curry", si: "මෝර මස් කරවල" },
      { name: "Sprats Curry", si: "හාල්මැස්සන් කරවල" },
      { name: "Squid Curry", si: "දැල්ලා කරවල" },
      { name: "Eel Curry", si: "ආඳා කරවල" },
      { name: "Duck Curry", si: "බත්තු මස් කරවල" },
      { name: "Turkey Curry", si: "ටර්කී මස් කරවල" },
      { name: "Quail Curry", si: "වටු මස් කරවල" },
      { name: "Beef Smore", si: "බීෆ් ස්මෝර්" },
      { name: "Chicken Korma", si: "කුකුළු මස් කෝර්මා" },
      { name: "Mutton Korma", si: "එළු මස් කෝර්මා" },
      { name: "Liver Fry Curry", si: "අක්මාව බැදපු කරවල" },
      { name: "Beef Lung Curry", si: "බීෆ් පෙනහළු කරවල" },
    ],
  },
  "Mixed, Fusion & Street Food": {
    si: "මිශ්‍ර, සම්ප්‍රදායික හා වීදි ආහාර",
    dishes: [
      { name: "Chicken Lamprais", si: "චිකන් ලැම්ප්‍රයිස්" },
      { name: "Chicken Kottu Roti", si: "චිකන් කොත්තු රොටි" },
      { name: "Mutton Biryani", si: "මට්න් බිරියානි" },
      { name: "Egg Kottu Roti", si: "බිත්තර කොත්තු" },
      { name: "Cheese Kottu", si: "චීස් කොත්තු" },
      { name: "String Hopper Biryani", si: "ඉඳියාප්ප බිරියානි" },
      { name: "Pittu Kottu", si: "පිට්ටු කොත්තු" },
      { name: "Yellow Rice and Curry", si: "කහ බත් සහ කරවල" },
      { name: "Ghee Rice", si: "ගී බත්" },
      { name: "Yellow Rice Combo", si: "කහ බත් සම්භවය" },
      { name: "Hoppers with Curry", si: "ආප්ප සහ හොදි" },
      { name: "String Hoppers with Curry", si: "ඉඳියාප්ප සහ හොදි" },
      { name: "Pittu with Curry", si: "පිට්ටු සහ හොදි" },
      { name: "Roti with Curry", si: "පරාටා / රොටි සහ හොදි" },
      { name: "Indiyappam Biryani", si: "ඉඳියාප්ප බිරියානි" },
      { name: "Chicken Fried Rice", si: "චිකන් ෆ්‍රයිඩ් රයිස්" },
      { name: "Mixed Fried Rice", si: "මිශ්‍ර ෆ්‍රයිඩ් රයිස්" },
      { name: "Nasi Sri Lankan Style", si: "නසි ගොරෙං ශ්‍රී ලංකා ක්‍රමයට" },
      { name: "Savory Bun", si: "පිරවුම් බනිස්" },
      { name: "Fish Bun", si: "මාළු බනිස්" },
      { name: "Egg Roti", si: "බිත්තර රොටි" },
      { name: "Vegetable Roti", si: "එළවළු රොටි" },
      { name: "Roll with Curry", si: "රෝල්ස්" },
      { name: "Pittu Wrap", si: "පිට්ටු රැප්" },
      { name: "Egg Hopper Combo", si: "බිත්තර ආප්ප කොම්බෝ" },
    ],
  },
  "Salads, Sambols & Relishes": {
    si: "සලාද, සම්බෝල හා අතුරු කෑම",
    dishes: [
      { name: "Gotukola Sambol", si: "ගොටුකොළ සම්බෝල" },
      { name: "Mukunuwenna Sambol", si: "මුකුණුවැන්න සම්බෝල" },
      { name: "Pol Sambol", si: "පොල් සම්බෝල" },
      { name: "Seeni Sambol", si: "සීනි සම්බෝල" },
      { name: "Lunu Miris", si: "ලුනු මිරිස්" },
      { name: "Gotukola Mallung", si: "ගොටුකොළ මැල්ලුම්" },
      { name: "Cabbage Mallung", si: "ගෝවා මැල්ලුම්" },
      { name: "Kale Mallung", si: "කේල් මැල්ලුම්" },
      { name: "Kos Kola Mallung", si: "කොස් කොළ මැල්ලුම්" },
      { name: "Carrot Sambol", si: "කැරට් සම්බෝල" },
      { name: "Cucumber Salad", si: "පිපිඤ්ඤා සලාද" },
      { name: "Onion Sambol", si: "ලූනු සම්බෝල" },
      { name: "Tomato Sambol", si: "තක්කාලි සම්බෝල" },
      { name: "Green Mango Salad", si: "අඹ සලාද" },
      { name: "Pineapple Salad", si: "අනනස් සලාද" },
      { name: "Katta Sambol", si: "කටු සම්බෝල" },
      { name: "Maldive Fish Sambol", si: "මෝල්දිව් මාළු සම්බෝල" },
      { name: "Ash Plantain Moju", si: "අළු කෙසෙල් මෝජු" },
      { name: "Brinjal Moju", si: "වම්බටු මෝජු" },
      { name: "Brinjal Pahi", si: "වම්බටු පහි" },
      { name: "Beetroot Raita", si: "බීට්‌රූට් රයිතා" },
      { name: "Cucumber Raita", si: "පිපිඤ්ඤා රයිතා" },
      { name: "Onion Raita", si: "ලූනු රයිතා" },
      { name: "Gotukola and Coconut Salad", si: "ගොටුකොළ සහ පොල් සලාද" },
      { name: "Centella Salad", si: "ශාක සලාද" },
    ],
  },
  "Fried, Dry & Bite Dishes": {
    si: "බැදුම්, වියළි හා බයිට් වර්ග",
    dishes: [
      { name: "Ala Theldala", si: "අර්තාපල් තෙල්දාලා" },
      { name: "Wambatu Theldala", si: "වම්බටු තෙල්දාලා" },
      { name: "Ash Plantain Theldala", si: "අළු කෙසෙල් තෙල්දාලා" },
      { name: "Bitter Gourd Fry", si: "කරවිල බැදුම" },
      { name: "Devilled Chicken", si: "දෙවලඩ් චිකන්" },
      { name: "Devilled Pork", si: "දෙවලඩ් පෝක්" },
      { name: "Devilled Prawns", si: "දෙවලඩ් ඉස්සන්" },
      { name: "Devilled Cuttlefish", si: "දෙවලඩ් දැල්ලා" },
      { name: "Devilled Cashew and Peas", si: "කජු සහ බෝංචි දෙවලඩ්" },
      { name: "Devilled Paneer", si: "දෙවලඩ් පනීර්" },
      { name: "Fried Sprats", si: "බැද්ද හාල්මැස්සන්" },
      { name: "Fried Halmessa", si: "බැද්ද හාල්මැස්සන්" },
      { name: "Mutton Cutlets", si: "එළු මස් කට්ලට්" },
      { name: "Fish Cutlets", si: "මාළු කට්ලට්" },
      { name: "Vegetable Cutlets", si: "එළවළු කට්ලට්" },
      { name: "Egg Rolls", si: "බිත්තර රෝල්ස්" },
      { name: "Mutton Rolls", si: "එළු මස් රෝල්ස්" },
      { name: "Fish Pastry", si: "මාළු පේස්ට්‍රි" },
      { name: "Chicken Patties", si: "චිකන් පැටිස්" },
      { name: "Chicken Devilled Bites", si: "චිකන් දෙවලඩ් බයිට්ස්" },
      { name: "Pork Black Pepper Fry", si: "කළු ගම්මිරිස් ඌරු මස් බැදුම" },
      { name: "Chicken Wings Spicy", si: "ස්පයිසි චිකන් විංග්ස්" },
      { name: "Sausage Devilled", si: "සොසේජස් දෙවලඩ්" },
      { name: "Fried Vadai", si: "උළුඳු වඩේ" },
      { name: "Parippu Vadai", si: "පරිප්පු වඩේ" },
    ],
  },
  "Bread, Buns & Beer Snacks": {
    si: "පාන්, බනිස්, බියර් බයිට් සහ සුලු කෑම",
    dishes: [
      { name: "Fish Bun", si: "මාළු බනිස්" },
      { name: "Egg Bun", si: "බිත්තර බනිස්" },
      { name: "Sausage Bun", si: "සොසේජස් බනිස්" },
      { name: "Seeni Sambol Bun", si: "සීනි සම්බෝල බනිස්" },
      { name: "Fish Pastry", si: "මාළු පැස්ට්‍රි" },
      { name: "Chicken Patties", si: "චිකන් පැටිස්" },
      { name: "Vegetable Roti", si: "එළවළු රොටි" },
      { name: "Egg Roti", si: "බිත්තර රොටි" },
      { name: "Mutton Roll", si: "එළු මස් රෝල්ස්" },
      { name: "Fish Cutlet", si: "මාළු කට්ලට්" },
      { name: "Devilled Peanuts", si: "දෙවලඩ් රටකජු" },
      { name: "Masala Cashews", si: "මසාලා කජු" },
      { name: "Chili Garlic Peanuts", si: "චිලි ගාර්ලික් රටකජු" },
      { name: "Fried Chickpeas", si: "බැද්ද කඩල" },
      { name: "Wade", si: "පරිප්පු වඩේ" },
      { name: "Ulundu Wade", si: "උළුඳු වඩේ" },
      { name: "Isso Wade", si: "ඉස්සන් වඩේ" },
      { name: "Crispy Tapioca Chips", si: "හැපෙනසුළු මඤ්ඤොක්කා චිප්ස්" },
      { name: "Banana Chips", si: "ස්පයිසි කෙසෙල් චිප්ස්" },
      { name: "Garlic Bread", si: "ස්ථානීය ක්‍රමයට ගාර්ලික් බ්‍රෙඩ්" },
      { name: "Devilled Sausage Bites", si: "දෙවලඩ් සොසේජස් බයිට්ස්" },
      { name: "Pepper Beef Bites", si: "ගම්මිරිස් බීෆ් බයිට්ස්" },
      { name: "Crispy Fried Pork Strips", si: "හැපෙනසුළු ඌරු මස් තීරු බැදුම" },
      { name: "Chicken Giblets Devilled", si: "චිකන් ගිබ්ලට්ස් දෙවලඩ්" },
      { name: "Papadum Bites", si: "පප්පඩම් බයිට්ස්" },
    ],
  },
};

/** Flat list of all 150 dish entries (name + si + category) for the seed script. */
export const LANKA_DISHES_FLAT_ENTRIES = Object.entries(LANKA_DISHES_150).flatMap(
  ([category, { dishes }]) => dishes.map((d) => ({ ...d, category })),
);

/** Flat list of just the English dish names — used by the app's Plan Menu picker. */
export const LANKA_DISHES_FLAT = LANKA_DISHES_FLAT_ENTRIES.map((d) => d.name);

/** Total count (rendered in UI copy so it stays truthful if the list changes). */
export const LANKA_DISHES_COUNT = LANKA_DISHES_FLAT.length;
