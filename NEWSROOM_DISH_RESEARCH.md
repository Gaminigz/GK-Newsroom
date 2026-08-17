# Dish research — the newsroom's job for the shop app

**Gamini's rule, 17 Aug 2026:** the app never calls Google, Gemini or GPT. The
**newsroom** does that research, writes the result into **Mongo**, and from
there it is ours. When the app meets a dish it does not know, it throws the
name back to the newsroom, the newsroom researches it, and the app picks it up
on the next read — no deploy, no API key in the serving path.

```
shop owner pastes a menu
   │
   ▼
app reads it  ──►  dish already known?  ──yes──►  costed, shelved, priced
   │                                    
   └── no ──►  lanka_dishes { needsReview: true }   ◄── the queue
                        │
                        ▼
              NEWSROOM researches (Gemini/GPT/search allowed here)
                        │
                        ▼
              writes the fields below back to the same doc
                        │
                        ▼
              app reads Mongo on the next request — done
```

---

## 1. The queue: what the app leaves for you

Every dish a shop pastes that the catalogue has never held is created in
`lanka_dishes` and flagged. Find your work with:

```js
db.lanka_dishes.find({ needsReview: true }).sort({ addedAt: 1 })
```

Each carries what the app could work out on its own:

| field | meaning |
|---|---|
| `_id` | the name, lowercased — the key everything joins on |
| `name` | as the shop wrote it (`"Banana blooms"`) — do not rewrite it |
| `nameSi` | Sinhala if the shop gave one, `""` if not |
| `category` | our guess from the name; correct it if wrong |
| `looksLike` | nearest recipe we already hold (`"Ash Plantain Curry"`) |
| `looksLikeScore` | 0–1, how sure that guess is. Under 0.5 = barely a hint |
| `addedBy` | the shop id that first used it |
| `source` | `"owner-paste"` |

As of 17 Aug there are **31** of these waiting, including *Banana blooms*,
*Beef Bistake*, *Dolphin Kottu*, *Spongaud curry*, *Temperate Tin fish*,
*Fried papadam and dry chilli*, *Ponni sambaa*.

---

## 2. What to write back

Update the **same document**. Three ways to satisfy a dish, cheapest first:

### a) It is a name for something we already have

```js
db.lanka_dishes.updateOne({ _id: "banana blooms" }, { $set: {
  aliasOf: "Ash Plantain Curry",      // must match a name in src/data/spices.ts
  nameSi: "කෙසෙල් මුව",
  category: "Vegetable Curries",
  needsReview: false,
  researchedAt: new Date(),
  researchedBy: "newsroom",
}});
```

The app resolves `aliasOf` to that recipe and costs the dish immediately.

### b) It is genuinely its own dish — give it a recipe

```js
db.lanka_dishes.updateOne({ _id: "dolphin kottu" }, { $set: {
  nameSi: "ඩොල්ෆින් කොත්තු",
  category: "Rice & Staples",
  priceLkr: 950,                       // a suggested selling price, optional
  ingredients: [                       // a table for FIVE people
    { name: "Godhamba roti", qty5: "5 pieces" },
    { name: "Chicken", qty5: "400 g" },
    { name: "Onion", qty5: "150 g" },
    { name: "Egg", qty5: "3 pieces" },
    { name: "Curry leaves", qty5: "2 sprigs" },
    { name: "Salt", qty5: "to taste" },
  ],
  sources: ["https://…", "https://…"],   // where the research came from
  needsReview: false,
  researchedAt: new Date(),
  researchedBy: "newsroom",
}});
```

**`qty5` must read like the book does**: a number then a unit —
`"400 g"`, `"200 ml"`, `"2 tbsp"`, `"1 kg"`, `"3 pieces"`, `"2 sprigs"`,
`"1 large"`, or `"to taste"` when it has no quantity. The app divides by five
for one serving and converts the unit itself.

**Ingredient names**: use the plain ingredient — `"Chicken"`, not
`"Chicken, curry-cut"` if you can help it (though the app does strip the cut).
If an ingredient is not in the price library the app will say so on the cost
sheet, which is the signal to add it (§4).

### c) It is not a dish at all

A line the reader misread — `"Today's dinner"`, `"$"`, a marketing line:

```js
db.lanka_dishes.deleteOne({ _id: "today's dinner" });
```

Tell me when you do, so I can fix the reader that let it through.

---

## 3. The category vocabulary — use these exact strings

```
Rice & Staples
Vegetable Curries
Meat & Seafood Curries
Salads, Sambols & Relishes
Fried, Dry & Bite Dishes
Bread, Buns & Beer Snacks
Mixed, Fusion & Street Food
Bakery & Canteen Classics
Sri Lankan Cakes & Sweets
```

The app maps these onto the POS shelves a shop sees (Vegi meals, Chicken,
Beef, Pork, Sea food, Starters, Bites, Desserts, Drinks), so a wrong category
sells a rice as a bite.

---

## 4. Ingredient prices

Costing prices ingredients from `INGREDIENT_LIBRARY` in
`src/lib/ai-dish.mjs` — about 70 entries in LKR per 100g / 100ml / piece.
When a recipe you add uses something not in there, the cost sheet shows *"no
price held for X"*.

For now, tell me the ingredient and a Colombo price and I will add it. If this
becomes frequent we should move the library into Mongo as
`lanka_ingredients { _id, lkr, unit }` and have the app prefer that — say the
word and I will wire it the same way recipes now work.

Shops can already override any price with their own on the cost sheet, which
is how a Phnom Penh kitchen handles Cambodian prices.

---

## 5. How the app consumes your work

Nothing is cached, nothing needs a deploy:

- `aliasOf` and `ingredients` are read from `lanka_dishes` on **every** cost
  sheet request (`src/lib/app.mjs`, the `/suite/costs` block).
- `nameSi`, `category` and `priceLkr` are read whenever a shop pastes or picks
  that dish.
- Precedence: **shop's own typed cost** → **your Mongo recipe** → **your
  `aliasOf`** → **our static book** (`src/data/spices.ts`) → nothing, and the
  sheet says *no recipe yet*.

---

## 6. What the app will never do

- Call Google, Gemini, GPT or any other model at request time.
- Invent a recipe or a Sinhala name to fill a gap. It leaves it blank, shows
  *no recipe yet*, and files it here.

That boundary is the point of this document: research is the newsroom's job,
and the shop app only ever reads what came out of it.

---

## 7. A reasonable working rhythm

1. Query `needsReview: true`, oldest first.
2. Research each — alias if it is one of ours, full recipe if not.
3. Write it back, `needsReview: false`, with `sources`.
4. Anything that is not a dish, delete and tell me.
5. When the queue is empty, `db.lanka_dishes.countDocuments({ needsReview: true })`
   is 0 and every dish on every shop's menu is costable.
