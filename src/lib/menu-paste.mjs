/**
 * Paste-a-menu reader.
 *
 * A shop owner writes the day's menu in WhatsApp long before they open the
 * app — headings, dish names in English and Sinhala, a price here and there,
 * "select 04 items". This turns that text into the Plan Menu structure so
 * they paste once instead of ticking thirty boxes.
 *
 * Ours, not an API. It runs on the same box as the app, costs nothing, works
 * offline, can't be rate-limited, can't be capped mid-service, and reads the
 * same way every time. Everything it knows about Sri Lankan menus is in this
 * file, so when it gets something wrong the fix is a line of code here rather
 * than a prompt someone else's model may or may not honour.
 *
 * Nothing here touches Mongo. The route (`/menu/paste.json` in app.mjs)
 * decides what to create; this only reports what the text says.
 */

/** The rate the whole shop suite prices at — money() in the Plan Menu page
 *  divides by the same number. A "$5" on a pasted menu is LKR 1,500. */
export const USD_LKR = 300;

/** Sinhala block — used to tell a Sinhala name from an English one. */
const SI = /[඀-෿]/;

/** "5$" → 1500. "Rs 750" / "LKR 750" / "750" → 750. "" → null.
 *  Anything with a $ or "usd" is dollars; everything else is rupees, which
 *  is what an unmarked number means on a Sri Lankan menu. */
export function priceToLkr(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return null;
  const m = s.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const usd = /\$|usd|dollar/i.test(s);
  return Math.round(usd ? n * USD_LKR : n);
}

/** "Rise Set" is "Rice set" with a typo, and "Dessert" is the "Desert" this
 *  shop already made — owners type fast. Two characters of slop when matching
 *  a heading against the set names they are allowed to use, so a typo reuses
 *  a name instead of burning one of their three custom slots. */
export function nearName(a, b) {
  const x = String(a || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const y = String(b || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!x || !y) return false;
  if (x === y) return true;
  // Two characters of slop on a three-character name matches anything —
  // a shop's "1+1" would swallow every two-letter word in a heading.
  if (x.length < 5 || y.length < 5) return false;
  if (Math.abs(x.length - y.length) > 2) return false;
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    for (let j = 1; j <= y.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[y.length] <= 2;
}

/**
 * The set name a heading means, out of the ones this shop may use.
 *
 * Owners don't write bare labels. They write "For dessert watalappan is
 * available" and "Rice set for today" — the name is *inside* a sentence. So:
 * exact, then near-spelling, then the name found within the heading, longest
 * first so "Rice set" wins over "set". Returns "" when nothing fits.
 */
export function matchSetName(allowed, heading) {
  const h = String(heading || "").trim();
  const list = (allowed || []).filter(Boolean);
  if (!h || !list.length) return "";
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const exact = list.find((n) => n.toLowerCase() === h.toLowerCase());
  if (exact) return exact;
  const near = list.find((n) => nearName(n, h));
  if (near) return near;
  const hn = norm(h);
  const words = h.split(/\s+/).filter(Boolean);
  for (const n of [...list].sort((a, b) => norm(b).length - norm(a).length)) {
    const nn = norm(n);
    if (nn.length >= 5 && hn.includes(nn)) return n;
    for (let i = 0; i < words.length; i++) {
      for (let len = 1; len <= 3 && i + len <= words.length; len++) {
        if (nearName(n, words.slice(i, i + len).join(" "))) return n;
      }
    }
  }
  return "";
}

/** Which catalogue shelf a new dish belongs on, from its name alone. Keeps a
 *  pasted rice off the street-food shelf, where the POS would sell it as a
 *  Bite. */
export function guessCategory(name) {
  const s = String(name || "").toLowerCase();
  if (/watalappan|wattalappam|cake|pudding|sweet|dessert|ice cream|kavum|kokis|aluwa/.test(s)) return "Sri Lankan Cakes & Sweets";
  if (/\b(rice|bath|biryani|buriyani|kottu|noodle|string hopper|idiyappa|pittu|hopper|appa)\b/.test(s)) return "Rice & Staples";
  if (/chicken|pork|beef|mutton|fish|prawn|shrimp|squid|crab|cuttle|egg|malu|mas\b/.test(s)) return "Meat & Seafood Curries";
  if (/sambol|sambal|salad|mallu|mallum|achcharu|pickle|chutney/.test(s)) return "Salads, Sambols & Relishes";
  if (/roti|paratha|bun|bread|paan|vadai|cutlet|patty|roll/.test(s)) return "Bread, Buns & Beer Snacks";
  if (/curry|kariya|hodi|hoddi|dhal|parippu|polos|kos|bean|beetroot|pumpkin|cabbage|potato|jack|gotukola|leek|carrot|okra|brinjal|cashew/.test(s)) return "Vegetable Curries";
  return "Mixed, Fusion & Street Food";
}

/**
 * Read a pasted menu.
 *
 * @param {string} text        what the owner pasted
 * @param {object} opts
 * @param {string[]} opts.setTypes  set names this shop may use
 * @returns {{ok:boolean, source:string, menu?:object, error?:string}}
 */
export function parseMenuText(text, opts = {}) {
  const raw = String(text || "").trim();
  if (!raw) return { ok: false, error: "nothing pasted" };
  if (raw.length > 8000) return { ok: false, error: "that is too long — paste one day's menu" };
  return { ok: true, source: "reader", menu: readMenu(raw, opts) };
}

/* ---------------------------------------------------------------------------
 * The reader.
 *
 * A menu is blocks. Each block opens with a heading naming a set, and holds
 * dish lines under it. Both are written every which way, so each rule below
 * comes from a menu that was actually pasted:
 *
 *   Rice set                       <- heading
 *   Ponni samba white rice / පොන්නි සම්බා සුදූ බත්   <- name / Sinhala name
 *   Chicken / කුකුල් මස් 5$          <- ...with a price
 *   Side dishes for select 04 item's  <- heading carrying a pick count
 *   1.⁠ ⁠Dhal / පරිප්පු                <- numbered, with invisible spacing
 *   Rice set Ponni samba white rice / …   <- heading glued to its first dish
 *   For dessert watalappan is available   <- heading written as a sentence
 * ------------------------------------------------------------------------ */
function readMenu(raw, opts = {}) {
  const setTypes = opts.setTypes || [];
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const groups = [];
  let cur = null;
  const notes = [];
  const garbled = [];

  // A price on the line means it is something being sold, not a heading.
  const hasPrice = (l) => /\d\s*\$|\$\s*\d|(?:rs\.?|lkr)\s*\d/i.test(l);
  const priceIn = (l) => {
    const marked = l.match(/(?:rs\.?|lkr)?\s*\d+(?:\.\d+)?\s*\$|\$\s*\d+(?:\.\d+)?|(?:rs\.?|lkr)\s*[\d,]+/i);
    if (marked) return marked[0].trim();
    // "Devilled chicken කුකුල් මස් දෙවල් 1200" — a plain number at the end of a
    // dish line is rupees. Only at the end: a "1." in front is a list number.
    const bare = l.match(/(?:^|\s)([\d,]{2,6}(?:\.\d{1,2})?)\s*\/?=?\s*$/);
    return bare ? bare[1].trim() : "";
  };
  const numbered = (l) => /^\d+\s*[.)]/.test(l);
  const bulleted = (l) => /^[-•*·⁠]/.test(l);
  // Sinhala inside a block is a dish name — headings are written in English
  // on every menu we have seen, and losing a dish costs more than mistaking
  // the rare Sinhala heading for one.
  const isDishy = (l) => l.includes("/") || numbered(l) || bulleted(l)
    || (cur && (hasPrice(l) || SI.test(l)));
  // Leading numbering, bullets, and the zero-width joiners WhatsApp leaves
  // behind when a numbered list is copied out of it.
  const clean = (l) => l.replace(/^[\s\-•*·⁠]*\d*\s*[.)]?\s*/, "").replace(/[​‌‍⁠]/g, "").trim();

  /** "Rice set Ponni samba white rice / …" — the heading and the first dish
   *  typed on one line. Split them rather than saving a dish called both. */
  const splitHeading = (l) => {
    const words = l.split(/\s+/).filter(Boolean);
    for (let n = Math.min(4, words.length - 1); n >= 1; n--) {
      const head = words.slice(0, n).join(" ");
      const rest = words.slice(n).join(" ");
      // The remainder has to start like a dish name, or "Rice set / බත්
      // කට්ටලය" — a dish that happens to share the name — gets cut in half.
      if (!/^[^/]*[A-Za-z඀-෿]/.test(rest)) continue;
      if (setTypes.some((s) => nearName(s, head) || s.toLowerCase() === head.toLowerCase())) return [head, rest];
    }
    return null;
  };

  const queue = [];
  for (const l of lines) {
    const split = isDishy(l) ? splitHeading(l) : null;
    if (split) queue.push(split[0], split[1]);
    else queue.push(l);
  }

  for (const line of queue) {
    if (isDishy(line)) {
      if (!cur) { cur = { name: "Menu", setType: "", pick: 1, priceText: "", dishes: [] }; groups.push(cur); }
      const d = readDish(clean(line), priceIn, clean);
      if (d && looksMojibake(d.name)) { garbled.push(d.name.slice(0, 24)); continue; }
      // A broken Sinhala half doesn't cost the dish — the English name is
      // still good — but the owner is told, because the dish now has no
      // Sinhala and that is not what they pasted.
      if (d) { if (looksMojibake(d.nameSi)) { d.nameSi = ""; garbled.push(d.name); } cur.dishes.push(d); }
      continue;
    }
    // A heading: short, and not a sentence about the shop.
    if (line.length <= 46 && !/[.!?]$/.test(line)) {
      const pick = pickCount(line);
      // "Side dishes for select 04 item's" names the set in the first half.
      const name = line.replace(/\b(for\s+)?(select|choose|pick|any)\b.*$/i, "")
        .replace(/[:\-–,]\s*$/, "").trim() || line;
      const hit = matchSetName(setTypes, name) || matchSetName(setTypes, line);
      cur = { name: (hit || name).slice(0, 40), setType: hit || "", pick, priceText: priceIn(line), dishes: [] };
      groups.push(cur);
      continue;
    }
    // Long line, or a sentence. It may still be naming a set — "For dessert
    // watalappan is available" is this shop's Desert.
    const hit = matchSetName(setTypes, line);
    if (hit && !hasPrice(line)) {
      cur = { name: hit, setType: hit, pick: pickCount(line), priceText: "", dishes: [] };
      groups.push(cur);
      continue;
    }
    notes.push(line);
  }
  return normalise({
    meal: mealIn(raw), day: dayIn(raw), note: notes.join(" ").slice(0, 200), groups,
    garbled: garbled.length,
  });
}

/**
 * Sinhala that lost its encoding on the way in — "පොන්නි" arriving as
 * "‡∂¥‡∑ú‡∂±‡∑ä". It happens when text crosses a pasteboard that decodes UTF-8
 * as MacRoman (the iOS Simulator's does). Left alone it would put permanent
 * rubbish in the catalogue every other shop reads, so a line like this is
 * kept out and reported back instead.
 */
export function looksMojibake(s) {
  const t = String(s || "");
  const marks = (t.match(/[‡†∂∑ΩÎÄâÃ¬Â]/g) || []).length;
  return marks >= 3 && marks / t.length > 0.12;
}

/** One dish line → {name, nameSi, priceText}. Handles "name / Sinhala 5$",
 *  "name 5$", and "name සිංහල 5$" with no slash between them. */
function readDish(body, priceIn, clean) {
  const price = priceIn(body);
  const noPrice = (price ? body.replace(price, "") : body).trim();
  let en = noPrice;
  let si = "";
  if (noPrice.includes("/")) {
    const parts = noPrice.split("/");
    en = parts[0];
    si = parts.slice(1).join("/");
  } else {
    // No slash: the Sinhala name usually just follows the English one.
    const at = noPrice.search(SI);
    if (at > 0) { en = noPrice.slice(0, at); si = noPrice.slice(at); }
  }
  // "(Sunday special price)" is a note about the dish, not part of its name.
  const name = clean(en.replace(/\([^)]*\)/g, "")).replace(/[-–,:]\s*$/, "").trim();
  if (!name) return null;
  return {
    name: name.slice(0, 80),
    nameSi: si.replace(/\([^)]*\)/g, "").trim().slice(0, 120),
    priceText: price,
    category: "",
    match: "",
  };
}

/** "select 04 item's" → 4. "choose any two" → 2. Nothing said → 1. */
function pickCount(line) {
  const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const m = line.match(/(?:select|choose|pick|any)\s*(?:any\s*)?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b/i)
    || line.match(/\b(\d{1,2})\s*(?:item|items|item's|dish|dishes|curries|curry)\b/i);
  if (!m) return 1;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : WORDS[m[1].toLowerCase()];
  return Math.max(1, Math.min(40, n || 1));
}

const MEAL_WORDS = ["Breakfast", "Lunch", "Dinner"];
const DAY_WORDS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
/** The meal the text names, if it names one. The page still decides — this is
 *  only reported back so the owner can be told they pasted a Dinner menu onto
 *  Lunch. */
function mealIn(raw) { return MEAL_WORDS.find((m) => new RegExp("\\b" + m + "\\b", "i").test(raw)) || ""; }
function dayIn(raw) { return DAY_WORDS.find((d) => new RegExp("\\b" + d + "\\b", "i").test(raw)) || ""; }

/** Trim everything to the lengths the plan route accepts. */
function normalise(menu) {
  const groups = (menu.groups || []).slice(0, 12).map((g) => ({
    name: String(g?.name || "").trim().slice(0, 40),
    setType: String(g?.setType || "").trim().slice(0, 40),
    pick: Math.max(1, Math.min(40, Number(g?.pick) || 1)),
    priceText: String(g?.priceText || "").trim().slice(0, 24),
    dishes: (g?.dishes || []).slice(0, 40).map((d) => ({
      name: String(d?.name || "").trim().replace(/\s+/g, " ").slice(0, 80),
      nameSi: String(d?.nameSi || "").trim().slice(0, 120),
      priceText: String(d?.priceText || "").trim().slice(0, 24),
      category: String(d?.category || "").trim().slice(0, 60),
      match: String(d?.match || "").trim().slice(0, 80),
    })).filter((d) => d.name),
  })).filter((g) => g.name && g.dishes.length);
  return {
    meal: String(menu.meal || "").trim(),
    day: String(menu.day || "").trim(),
    note: String(menu.note || "").trim().slice(0, 200),
    garbled: Number(menu.garbled) || 0,
    groups,
  };
}
