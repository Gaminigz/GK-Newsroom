/**
 * KHQR — reading a shop's own printed QR and re-issuing it with an amount.
 *
 * Gamini's idea, and it works: a shop already has a KHQR sticker from ABA.
 * That printed code is a STATIC QR — it names the merchant's account but
 * carries no amount, which is why the payer has to type the money in.
 *
 * KHQR is an open standard (EMVCo, overseen by the National Bank of
 * Cambodia), so the payload is readable and rebuildable. Take the shop's
 * static code, set the amount and an order reference, recompute the
 * checksum, and out comes a valid DYNAMIC KHQR that any Cambodian bank app
 * scans with "US$2.25" already filled in — paying the shop's own account,
 * with no gateway between us and the money.
 *
 * What this cannot do is tell us the payment happened. A gateway-less QR
 * means no webhook, so the order is confirmed by the shop, not by us. That
 * is the honest trade: instant setup, manual confirmation.
 *
 * Field numbers below are ABA's own KHQR Guideline:
 * https://developer.payway.com.kh/khqr-guideline-3192101f0
 */

/** Every KHQR is TLV: two-digit tag, two-digit length, then the value. */
export function parseTlv(payload) {
  const out = [];
  let i = 0;
  const s = String(payload || "");
  while (i + 4 <= s.length) {
    const tag = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(tag) || !Number.isFinite(len)) return out;
    const value = s.slice(i + 4, i + 4 + len);
    if (value.length < len) return out;              // truncated — stop here
    out.push({ tag, value });
    i += 4 + len;
  }
  return out;
}

export function buildTlv(entries) {
  return entries
    .filter((e) => e.value !== "" && e.value != null)
    .map((e) => e.tag + String(e.value.length).padStart(2, "0") + e.value)
    .join("");
}

/**
 * CRC-16/CCITT-FALSE over the whole payload including the trailing "6304".
 * Every bank app checks this; a wrong checksum is simply an unreadable code.
 */
export function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Is this string actually a KHQR, and whose? Used to check an upload. */
export function readKhqr(payload) {
  const t = parseTlv(payload);
  if (!t.length) return { ok: false, error: "That image is not a QR payload we can read." };
  const get = (tag) => t.find((x) => x.tag === tag)?.value || "";
  if (get("00") !== "01") return { ok: false, error: "Not an EMV/KHQR code." };
  const country = get("58");
  const merchantName = get("59");
  // Tags 26–51 hold merchant account info; KHQR uses 29/30 for Bakong/ABA.
  const acct = t.find((x) => Number(x.tag) >= 26 && Number(x.tag) <= 51);
  if (!acct) return { ok: false, error: "No merchant account in that QR." };
  const inner = parseTlv(acct.value);
  const bakongId = inner.find((x) => x.tag === "00")?.value || "";
  return {
    ok: true,
    static: get("01") !== "12",
    country, merchantName,
    city: get("60"),
    bakongId,
    bankName: inner.find((x) => x.tag === "02")?.value || "",
    currency: get("53"),
    hasAmount: !!get("54"),
  };
}

const CURRENCY_NUM = { USD: "840", KHR: "116" };

/**
 * Re-issue a shop's static KHQR as a dynamic one carrying this order's
 * amount and reference.
 *
 * The merchant's own account tags are copied across untouched — we are not
 * inventing a payee, only filling in the blanks the printed code left for
 * the payer to type.
 */
export function khqrWithAmount(staticPayload, { amount, currency = "USD", reference = "" } = {}) {
  const src = parseTlv(staticPayload);
  if (!src.length) return { ok: false, error: "Could not read the shop's QR." };

  const num = CURRENCY_NUM[currency] || CURRENCY_NUM.USD;
  // KHR is a whole-riel currency — the guideline is explicit that decimals
  // must not appear. USD carries its cents.
  const amt = currency === "KHR"
    ? String(Math.round(Number(amount) || 0))
    : (Number(amount) || 0).toFixed(2);
  if (!(Number(amt) > 0)) return { ok: false, error: "No amount to charge." };

  const keep = new Map();
  for (const { tag, value } of src) keep.set(tag, value);

  keep.set("00", "01");
  keep.set("01", "12");            // 12 = dynamic: this code carries a sum
  keep.set("53", num);
  keep.set("54", amt);

  // 62 is the additional-data template; 62/01 is the merchant's reference,
  // which is how the shop recognises this payment as this order.
  if (reference) {
    const add = parseTlv(keep.get("62") || "");
    const rest = add.filter((x) => x.tag !== "01");
    keep.set("62", buildTlv([{ tag: "01", value: String(reference).slice(0, 25) }, ...rest]));
  }
  // 99 carries Bakong's creation/expiry stamps for the code it came on;
  // copying stale ones onto a new code is worse than leaving it out.
  keep.delete("99");
  keep.delete("63");

  const ordered = [...keep.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([tag, value]) => ({ tag, value }));

  // A partly-readable source would rebuild into a QR missing mandatory
  // fields — one that scans but is refused at the moment of payment. Better
  // to say the sticker is unreadable than to hand a buyer a broken code.
  const mandatory = ["00", "01", "53", "58", "59"];
  const missing = mandatory.filter((t) => !keep.get(t));
  const hasAccount = ordered.some((e) => Number(e.tag) >= 26 && Number(e.tag) <= 51);
  if (missing.length || !hasAccount) {
    return { ok: false, error: `That QR is missing ${!hasAccount ? "its merchant account" : "field " + missing.join(", ")} — upload a clearer photo of the shop's KHQR.` };
  }

  const body = buildTlv(ordered) + "6304";
  return { ok: true, payload: body + crc16(body), amount: amt, currency };
}

/** The link that opens ABA Mobile straight onto this payment. */
export function abaDeeplink(payload) {
  return `abamobilebank://ababank.com?type=payway&qrcode=${encodeURIComponent(payload)}`;
}

/**
 * Pull the KHQR payload out of a photo or screenshot of the shop's code.
 * sharp normalises whatever the phone produced; jsQR reads the pixels.
 */
export async function decodeQrImage(buffer) {
  const [{ default: sharp }, { default: jsQR }] = await Promise.all([
    import("sharp"), import("jsqr"),
  ]);
  // Try the image as-is, then progressively larger — a QR photographed at an
  // angle or downscaled by a messaging app often needs the second pass.
  for (const width of [0, 800, 1400]) {
    let img = sharp(buffer).ensureAlpha();
    if (width) img = img.resize({ width, withoutEnlargement: false });
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    const found = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    if (found?.data) return { ok: true, payload: found.data };
  }
  return { ok: false, error: "No QR code found in that image — try a straighter, brighter photo." };
}
