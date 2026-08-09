// Extract every <script> block the suite pages emit and syntax-check it, so a
// broken client script can't ship silently (a bad edit once ate an `async`).
import { MongoClient, ObjectId } from "mongodb";
import { suitePage } from "./src/lib/shop-suite.mjs";
import { execSync } from "node:child_process";
import fs from "node:fs";

const SHOP = "6a75718da2de19ffac236055";
const c = new MongoClient(process.env.MONGO_URL);
await c.connect();
const db = c.db(process.env.MONGO_DB || "gk_newsroom");
const shop = await db.collection("shop_owners").findOne({ _id: new ObjectId(SHOP) });
const all = await db.collection("app_dishes").find({ shopId: SHOP }).toArray();
const feed = await db.collection("lanka_dishes").find({}, { projection: { name: 1, nameSi: 1, category: 1 } }).toArray();
const today = new Date().toISOString().slice(0, 10);
let bad = 0;
for (const key of ["menu", "pos", "kitchen", "stock"]) {
  const html = suitePage(shop, key, {
    singles: all.filter((d) => d.type !== "set"), sets: all.filter((d) => d.type === "set"),
    presetDishes: [], feedDishes: feed, planDate: today, planMeal: "Lunch", dayPlan: null,
    dishes: all, kitchenOrders: [], pendingOrders: [], stock: [], ingredientCats: {}, units: [],
    currency: { code: "LKR", symbol: "Rs" }, statusCounts: {}, todaysSales: { count: 0, total: 0 },
  }) || "";
  const blocks = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1]).filter((b) => b.trim() && !b.includes("application/json"));
  blocks.forEach((b, i) => {
    const f = `/tmp/_cjs_${key}_${i}.js`;
    fs.writeFileSync(f, `(async function(){\n${b}\n})();`);
    try { execSync(`node --check ${f}`, { stdio: "pipe" }); }
    catch (e) { bad++; console.error(`FAIL ${key} block ${i}:\n${e.stderr?.toString().split("\n").slice(0, 4).join("\n")}`); }
  });
  console.log(`${key}: ${blocks.length} script block(s) checked`);
}
await c.close();
console.log(bad ? `\n${bad} BROKEN` : "\nall client scripts parse");
process.exit(bad ? 1 : 0);
