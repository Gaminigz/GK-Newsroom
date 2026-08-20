/**
 * ABA PayWay — KHQR checkout for 3una 5aha.
 *
 * The one payment rule this repo lives by is "no third-party service in the
 * request path", and a payment gateway is the exception that proves it: money
 * cannot clear locally. So this file keeps the dependency small and honest —
 * three thin calls (create a QR, check a transaction, verify a webhook), all
 * signed the way ABA's docs demand, nothing cached, nothing clever.
 *
 * Credentials are the SHOP'S own, typed into Bank setup. Each shop signs with
 * its own merchant profile, so its takings land in its own ABA account — the
 * app never holds one central merchant key over everyone's money.
 *
 * Docs: https://developer.payway.com.kh — Purchase, Check transaction,
 * KHQR Guideline. Sandbox and production differ only by host.
 */
import crypto from "node:crypto";

export const PAYWAY_BASE = {
  sandbox: "https://checkout-sandbox.payway.com.kh/",
  production: "https://checkout.payway.com.kh/",
};

/** UTC timestamp the way PayWay wants it: YYYYMMDDHHmmss. */
export function reqTime(d = new Date()) {
  return d.toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

/* The hash covers every field in THIS exact order — ABA's order, not the
 * order the params happen to be listed in. A field we do not send still takes
 * part as an empty string; get one wrong and every request dies on "invalid
 * hash", which is where most PayWay integrations spend their first day. */
const HASH_ORDER = [
  "req_time", "merchant_id", "tran_id", "amount", "items", "shipping",
  "firstname", "lastname", "email", "phone", "type", "payment_option",
  "return_url", "cancel_url", "continue_success_url", "return_deeplink",
  "currency", "custom_fields", "return_params", "payout", "lifetime",
  "additional_params", "google_pay_token", "skip_success_page",
];

export function paywaySign(fields, apiKey) {
  const b4 = HASH_ORDER.map((k) => (fields[k] == null ? "" : String(fields[k]))).join("");
  return crypto.createHmac("sha512", apiKey).update(b4).digest("base64");
}

/**
 * Ask PayWay for a KHQR the buyer can pay from any Cambodian bank app.
 *
 * payment_option abapay_khqr_deeplink means PayWay answers with JSON —
 * qr_string, abapay_deeplink, checkout_qr_url — instead of its own hosted
 * page, so the QR lives inside our order screen and the buyer never leaves.
 */
export async function paywayCreateQr({ merchantId, apiKey, env, tranId, amountUsd, buyerName, buyerPhone, itemsList, callbackUrl, lifetimeMin = 15 }) {
  const fields = {
    req_time: reqTime(),
    merchant_id: merchantId,
    tran_id: tranId,
    amount: amountUsd,                               // string, e.g. "4.25"
    firstname: buyerName || "",
    phone: buyerPhone || "",
    payment_option: "abapay_khqr_deeplink",
    // return_url doubles as the webhook: PayWay POSTs the payment result
    // here. Base64, per the docs — and the domain must be whitelisted with
    // ABA or every request fails with error 81.
    return_url: Buffer.from(callbackUrl).toString("base64"),
    currency: "USD",
    lifetime: String(lifetimeMin),
    items: itemsList?.length
      ? Buffer.from(JSON.stringify(itemsList.slice(0, 10))).toString("base64").slice(0, 500)
      : "",
  };
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== "") form.append(k, v);
  form.append("hash", paywaySign(fields, apiKey));

  const res = await fetch(`${PAYWAY_BASE[env] || PAYWAY_BASE.sandbox}api/payment-gateway/v1/payments/purchase`, {
    method: "POST", body: form,
  });
  const text = await res.text();
  try {
    const j = JSON.parse(text);
    // Shapes vary between doc versions; read both spellings of everything.
    const qr = j.qr_string || j.qrString || j.data?.qr_string || "";
    const deeplink = j.abapay_deeplink || j.data?.abapay_deeplink || "";
    const qrUrl = j.checkout_qr_url || j.data?.checkout_qr_url || "";
    const code = j.status?.code ?? j.status_code ?? (qr || qrUrl ? "00" : "");
    if (!qr && !qrUrl) return { ok: false, error: j.status?.message || j.message || text.slice(0, 180) };
    return { ok: true, code, qr, deeplink, qrUrl, raw: j };
  } catch {
    // HTML back means PayWay rejected the request before it got anywhere —
    // wrong hash, unknown merchant, or an unwhitelisted return_url.
    return { ok: false, error: "PayWay answered with a page, not JSON — check merchant id, API key and URL whitelist. " + text.slice(0, 120).replace(/\s+/g, " ") };
  }
}

/**
 * Has this transaction been paid? The backstop for a missed webhook — valid
 * for 7 days after creation, simpler hash: req_time · merchant_id · tran_id.
 */
export async function paywayCheck({ merchantId, apiKey, env, tranId }) {
  const req_time = reqTime();
  const hash = crypto.createHmac("sha512", apiKey)
    .update(req_time + merchantId + tranId).digest("base64");
  const res = await fetch(`${PAYWAY_BASE[env] || PAYWAY_BASE.sandbox}api/payment-gateway/v1/payments/check-transaction-2`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ req_time, merchant_id: merchantId, tran_id: tranId, hash }),
  });
  let j = {};
  try { j = await res.json(); } catch { return { ok: false, paid: false }; }
  const status = j.data?.payment_status || j.payment_status || "";
  const codeRaw = j.data?.payment_status_code ?? j.payment_status_code;
  return { ok: true, paid: status === "APPROVED" || codeRaw === 0, status, raw: j };
}


/**
 * The hosted flow — ABA's own secure checkout page, where the payer picks
 * Card, ABA Pay or KHQR and pays inside ABA's window. We send a signed form;
 * everything after that (card fields, 3DS, the success screen) is ABA's.
 * When they finish, ABA walks the payer back to continue_success_url and
 * rings the same webhook as the inline QR.
 */
export function paywayHostedFields({ merchantId, apiKey, env, tranId, amountUsd, buyerName, buyerPhone, callbackUrl, continueUrl }) {
  const fields = {
    req_time: reqTime(),
    merchant_id: merchantId,
    tran_id: tranId,
    amount: amountUsd,
    firstname: buyerName || "",
    phone: buyerPhone || "",
    return_url: Buffer.from(callbackUrl).toString("base64"),
    continue_success_url: continueUrl,
    currency: "USD",
  };
  fields.hash = paywaySign(fields, apiKey);
  return { action: `${PAYWAY_BASE[env] || PAYWAY_BASE.sandbox}api/payment-gateway/v1/payments/purchase`, fields };
}
