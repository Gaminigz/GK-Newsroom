/**
 * Currencies a shop can choose to price in. Sri Lankan Rupee is the
 * default (the app's home market), but shops elsewhere can pick their
 * own — owner-entered prices (dish prices, kitchen-stock costs) then
 * display in that currency.
 *
 * `code` is the ISO 4217 code stored on the shop doc; `symbol` is what
 * prefixes an amount in the UI; `name` is the human label in the picker.
 */

export const CURRENCIES = [
  { code: "LKR", symbol: "Rs",  name: "Sri Lankan Rupee" },
  { code: "USD", symbol: "$",   name: "US Dollar" },
  { code: "EUR", symbol: "€",   name: "Euro" },
  { code: "GBP", symbol: "£",   name: "British Pound" },
  { code: "INR", symbol: "₹",   name: "Indian Rupee" },
  { code: "AUD", symbol: "A$",  name: "Australian Dollar" },
  { code: "CAD", symbol: "C$",  name: "Canadian Dollar" },
  { code: "SGD", symbol: "S$",  name: "Singapore Dollar" },
  { code: "MYR", symbol: "RM",  name: "Malaysian Ringgit" },
  { code: "AED", symbol: "AED", name: "UAE Dirham" },
  { code: "SAR", symbol: "SAR", name: "Saudi Riyal" },
  { code: "QAR", symbol: "QAR", name: "Qatari Riyal" },
  { code: "JPY", symbol: "¥",   name: "Japanese Yen" },
  { code: "CNY", symbol: "¥",   name: "Chinese Yuan" },
  { code: "THB", symbol: "฿",   name: "Thai Baht" },
  { code: "NZD", symbol: "NZ$", name: "New Zealand Dollar" },
];

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code);

const BY_CODE = Object.fromEntries(CURRENCIES.map((c) => [c.code, c]));

/** Resolve a shop's currency (defaults to LKR). Returns {code,symbol,name}. */
export function currencyOf(shop) {
  const code = shop && typeof shop.currency === "string" ? shop.currency : "LKR";
  return BY_CODE[code] || BY_CODE.LKR;
}

/** Format an amount with the shop's currency, e.g. "Rs 1,500" / "$12.50".
 *  Whole numbers show no decimals; fractional show two. */
export function fmtMoney(shop, amount) {
  const cur = currencyOf(shop);
  const n = Number(amount) || 0;
  const body = Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${cur.symbol} ${body}`;
}
