/**
 * 150 curated Sri Lankan dishes, categorised, per the 3una 5aha
 * newsroom-side dish catalogue. The app's Plan Menu picker pulls names
 * from here; the seed script (src/scripts/seed-lanka-recipes.mjs)
 * pre-computes per-serving ingredient recipes via Gemini and caches
 * them in Mongo (`app_dish_recipes`) so the app never has to hit the
 * AI at runtime for these dishes.
 *
 * Six categories × 25 dishes = 150.
 */

export const LANKA_DISHES_150 = {
  "Vegetable Curries": [
    "Parippu", "Polos", "Kiri Kos", "Potato White Curry", "Pumpkin Curry",
    "Beetroot Curry", "Cabbage Curry", "Bandakka Curry", "Drumstick Curry", "Snake Gourd Curry",
    "Radish Curry", "Cashew Nut Curry", "Mango Curry", "Pineapple Curry", "Ash Plantain Curry",
    "Tomato Curry", "Green Bean Curry", "Bitter Gourd Curry", "Knol Khol Curry", "Mushroom Curry",
    "Brinjal Curry", "Luffa Curry", "Lotus Root Curry", "Breadfruit Curry", "Ripe Jackfruit Curry",
  ],
  "Meat & Seafood Curries": [
    "Kukul Mas Curry", "Black Pork Curry", "Mutton Curry", "Sri Lankan Beef Curry",
    "Jaffna Mutton Kuzhambu", "Malu Mirisata", "Kiri Hodi Malu", "Prawn Curry", "Cuttlefish Curry",
    "Crab Curry", "Dry Fish Curry", "Ambul Thiyal", "Fish Ambul Thiyal", "Shark Curry",
    "Sprats Curry", "Squid Curry", "Eel Curry", "Duck Curry", "Turkey Curry", "Quail Curry",
    "Beef Smore", "Chicken Korma", "Mutton Korma", "Liver Fry Curry", "Beef Lung Curry",
  ],
  "Mixed, Fusion & Street Food": [
    "Chicken Lamprais", "Chicken Kottu Roti", "Mutton Biryani", "Egg Kottu Roti", "Cheese Kottu",
    "String Hopper Biryani", "Pittu Kottu", "Yellow Rice and Curry", "Ghee Rice", "Yellow Rice Combo",
    "Hoppers with Curry", "String Hoppers with Curry", "Pittu with Curry", "Roti with Curry",
    "Indiyappam Biryani", "Chicken Fried Rice", "Mixed Fried Rice", "Nasi Sri Lankan Style",
    "Savory Bun", "Fish Bun", "Egg Roti", "Vegetable Roti", "Roll with Curry", "Pittu Wrap",
    "Egg Hopper Combo",
  ],
  "Salads, Sambols & Relishes": [
    "Gotukola Sambol", "Mukunuwenna Sambol", "Pol Sambol", "Seeni Sambol", "Lunu Miris",
    "Gotukola Mallung", "Cabbage Mallung", "Kale Mallung", "Kos Mallung", "Carrot Sambol",
    "Cucumber Salad", "Onion Sambol", "Tomato Sambol", "Green Mango Salad", "Pineapple Salad",
    "Katta Sambol", "Maldive Fish Sambol", "Ash Plantain Moju", "Brinjal Moju", "Brinjal Pahi",
    "Beetroot Raita", "Cucumber Raita", "Onion Raita", "Gotukola and Coconut Salad",
    "Centella Salad",
  ],
  "Fried, Dry & Bite Dishes": [
    "Ala Theldala", "Wambatu Theldala", "Ash Plantain Theldala", "Bitter Gourd Fry",
    "Devilled Chicken", "Devilled Pork", "Devilled Prawns", "Devilled Cuttlefish",
    "Devilled Cashew and Peas", "Devilled Paneer", "Fried Sprats", "Fried Halmessa",
    "Mutton Cutlets", "Fish Cutlets", "Vegetable Cutlets", "Egg Rolls", "Mutton Rolls",
    "Fish Pastry", "Chicken Patties", "Chicken Devilled Bites", "Pork Black Pepper Fry",
    "Chicken Wings Spicy", "Sausage Devilled", "Fried Vadai", "Parippu Vadai",
  ],
  "Bread, Buns & Beer Snacks": [
    "Fish Bun", "Egg Bun", "Sausage Bun", "Seeni Sambol Bun", "Fish Pastry",
    "Chicken Patties", "Vegetable Roti", "Egg Roti", "Mutton Roll", "Fish Cutlet",
    "Devilled Peanuts", "Masala Cashews", "Chili Garlic Peanuts", "Fried Chickpeas (Kadala)",
    "Wade (Parippu Vadai)", "Ulundu Wade", "Isso Wade (Prawn Wade)", "Crispy Tapioca Chips",
    "Banana Chips (Spicy)", "Garlic Bread (Local Style)", "Devilled Sausage Bites",
    "Pepper Beef Bites", "Crispy Fried Pork Strips", "Devilled Chicken Giblets", "Papadum Bites",
  ],
};

/** Flat list of all 150 dish names — used by the app's Plan Menu picker. */
export const LANKA_DISHES_FLAT = Object.values(LANKA_DISHES_150).flat();

/** Total count (rendered in UI copy so it stays truthful if the list changes). */
export const LANKA_DISHES_COUNT = LANKA_DISHES_FLAT.length;
