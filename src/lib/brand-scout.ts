/**
 * Brand Scout — harvests AI-adoption signals for garment/apparel brands.
 *
 * LOCAL TOOL for the Yai sales effort (not wired into the public site or the
 * Railway cron). For each brand we ask Google News RSS (keyless) what the
 * brand is doing with AI, Gemini classifies each NEW story into a signal
 * category with a strength, brands accumulate an "AI-trendiness" score, and
 * the hottest brands get an auto-generated approach dossier: why now, the
 * Cambodia angle, who to target, the hook, an opener line.
 *
 * Collections:
 *   brand_signals  — one doc per story URL (judged once, re-runs are free)
 *   brands         — one doc per brand: score, signals, dossier, status/notes
 *
 * Run:  npm run brands        (harvest + judge + dossiers)
 * View: npm run brands-page   (local page on :8793)
 */

import Parser from "rss-parser";
import { GoogleGenAI, Type } from "@google/genai";

export type Brand = { name: string; iso: string; sector: string; cambodia?: boolean };

/** The brand universe: garment, footwear, bags/luggage, sportswear, outdoor,
 * underwear, kids, homeware and private-label retail — worldwide.
 * `cambodia: true` = known/likely Cambodia sourcing. Extend freely. */
export const BRANDS: Brand[] = [
  // — Sportswear & athletic footwear
  { name: "Nike", iso: "US", sector: "sports", cambodia: true },
  { name: "Adidas", iso: "DE", sector: "sports", cambodia: true },
  { name: "Puma", iso: "DE", sector: "sports", cambodia: true },
  { name: "Under Armour", iso: "US", sector: "sports", cambodia: true },
  { name: "New Balance", iso: "US", sector: "sports", cambodia: true },
  { name: "ASICS", iso: "JP", sector: "sports", cambodia: true },
  { name: "Reebok", iso: "US", sector: "sports" },
  { name: "Fila", iso: "KR", sector: "sports" },
  { name: "Li-Ning", iso: "CN", sector: "sports" },
  { name: "Anta Sports", iso: "CN", sector: "sports" },
  { name: "Xtep", iso: "CN", sector: "sports" },
  { name: "361 Degrees", iso: "CN", sector: "sports" },
  { name: "Peak Sport", iso: "CN", sector: "sports" },
  { name: "Mizuno", iso: "JP", sector: "sports" },
  { name: "Umbro", iso: "GB", sector: "sports" },
  { name: "Kappa", iso: "IT", sector: "sports" },
  { name: "Le Coq Sportif", iso: "FR", sector: "sports" },
  { name: "Diadora", iso: "IT", sector: "sports" },
  { name: "Lotto Sport", iso: "IT", sector: "sports" },
  { name: "Brooks Running", iso: "US", sector: "sports" },
  { name: "Saucony", iso: "US", sector: "sports" },
  { name: "Hoka", iso: "US", sector: "sports" },
  { name: "On Running", iso: "CH", sector: "sports" },
  { name: "Salomon", iso: "FR", sector: "outdoor" },
  { name: "K-Swiss", iso: "US", sector: "sports" },
  { name: "Lululemon", iso: "CA", sector: "sports", cambodia: true },
  { name: "Gymshark", iso: "GB", sector: "sports" },
  { name: "Fabletics", iso: "US", sector: "sports" },
  { name: "Alo Yoga", iso: "US", sector: "sports" },
  { name: "Vuori", iso: "US", sector: "sports" },
  // — Footwear (casual / classic)
  { name: "Skechers", iso: "US", sector: "footwear" },
  { name: "Crocs", iso: "US", sector: "footwear" },
  { name: "Birkenstock", iso: "DE", sector: "footwear" },
  { name: "Dr. Martens", iso: "GB", sector: "footwear" },
  { name: "Timberland", iso: "US", sector: "footwear" },
  { name: "Vans", iso: "US", sector: "footwear" },
  { name: "Converse", iso: "US", sector: "footwear" },
  { name: "Clarks", iso: "GB", sector: "footwear" },
  { name: "Ecco", iso: "DK", sector: "footwear" },
  { name: "Geox", iso: "IT", sector: "footwear" },
  { name: "Camper", iso: "ES", sector: "footwear" },
  { name: "Toms", iso: "US", sector: "footwear" },
  { name: "Allbirds", iso: "US", sector: "footwear" },
  { name: "Veja", iso: "FR", sector: "footwear" },
  { name: "Merrell", iso: "US", sector: "footwear" },
  { name: "Wolverine Worldwide", iso: "US", sector: "footwear" },
  { name: "Deckers Brands", iso: "US", sector: "footwear" },
  { name: "UGG", iso: "US", sector: "footwear" },
  { name: "Steve Madden", iso: "US", sector: "footwear" },
  { name: "Aldo", iso: "CA", sector: "footwear" },
  { name: "Bata", iso: "CH", sector: "footwear" },
  { name: "Deichmann", iso: "DE", sector: "footwear" },
  { name: "Kurt Geiger", iso: "GB", sector: "footwear" },
  { name: "Charles & Keith", iso: "SG", sector: "footwear" },
  // — Fast fashion & high street
  { name: "H&M", iso: "SE", sector: "fashion", cambodia: true },
  { name: "Inditex Zara", iso: "ES", sector: "fashion" },
  { name: "Uniqlo Fast Retailing", iso: "JP", sector: "fashion", cambodia: true },
  { name: "GU (Fast Retailing)", iso: "JP", sector: "fashion" },
  { name: "Gap Inc", iso: "US", sector: "fashion", cambodia: true },
  { name: "Primark", iso: "IE", sector: "fashion", cambodia: true },
  { name: "C&A", iso: "NL", sector: "fashion", cambodia: true },
  { name: "Next plc", iso: "GB", sector: "fashion", cambodia: true },
  { name: "Marks & Spencer", iso: "GB", sector: "fashion", cambodia: true },
  { name: "Bestseller", iso: "DK", sector: "fashion", cambodia: true },
  { name: "Mango", iso: "ES", sector: "fashion" },
  { name: "Shein", iso: "SG", sector: "fashion" },
  { name: "Forever 21", iso: "US", sector: "fashion" },
  { name: "American Eagle Outfitters", iso: "US", sector: "fashion" },
  { name: "Abercrombie & Fitch", iso: "US", sector: "fashion" },
  { name: "Urban Outfitters", iso: "US", sector: "fashion" },
  { name: "J.Crew", iso: "US", sector: "fashion" },
  { name: "Express", iso: "US", sector: "fashion" },
  { name: "Chico's", iso: "US", sector: "fashion" },
  { name: "Cotton On", iso: "AU", sector: "fashion" },
  { name: "Boohoo", iso: "GB", sector: "fashion" },
  { name: "ASOS", iso: "GB", sector: "fashion" },
  { name: "New Look", iso: "GB", sector: "fashion" },
  { name: "River Island", iso: "GB", sector: "fashion" },
  { name: "Matalan", iso: "GB", sector: "fashion" },
  { name: "George at ASDA", iso: "GB", sector: "fashion" },
  { name: "Tesco F&F", iso: "GB", sector: "fashion" },
  { name: "Sainsbury's Tu", iso: "GB", sector: "fashion" },
  { name: "Zalando", iso: "DE", sector: "fashion" },
  { name: "About You", iso: "DE", sector: "fashion" },
  { name: "Otto Group", iso: "DE", sector: "fashion" },
  { name: "Bonprix", iso: "DE", sector: "fashion" },
  { name: "s.Oliver", iso: "DE", sector: "fashion" },
  { name: "Tom Tailor", iso: "DE", sector: "fashion" },
  { name: "Esprit", iso: "DE", sector: "fashion" },
  { name: "Kiabi", iso: "FR", sector: "fashion" },
  { name: "Celio", iso: "FR", sector: "fashion" },
  { name: "Promod", iso: "FR", sector: "fashion" },
  { name: "Etam", iso: "FR", sector: "underwear" },
  { name: "Benetton", iso: "IT", sector: "fashion" },
  { name: "OVS", iso: "IT", sector: "fashion" },
  { name: "Calzedonia", iso: "IT", sector: "underwear" },
  { name: "Terranova", iso: "IT", sector: "fashion" },
  { name: "Desigual", iso: "ES", sector: "fashion" },
  { name: "Tendam Cortefiel", iso: "ES", sector: "fashion" },
  { name: "LPP Reserved", iso: "PL", sector: "fashion" },
  { name: "Pepco", iso: "PL", sector: "fashion" },
  { name: "Lindex", iso: "SE", sector: "fashion" },
  { name: "KappAhl", iso: "SE", sector: "fashion" },
  { name: "Gina Tricot", iso: "SE", sector: "fashion" },
  { name: "Varner Group", iso: "NO", sector: "fashion" },
  { name: "LC Waikiki", iso: "TR", sector: "fashion" },
  { name: "DeFacto", iso: "TR", sector: "fashion" },
  { name: "Koton", iso: "TR", sector: "fashion" },
  { name: "Mavi", iso: "TR", sector: "denim" },
  { name: "Giordano", iso: "HK", sector: "fashion" },
  { name: "Bossini", iso: "HK", sector: "fashion" },
  { name: "Semir", iso: "CN", sector: "fashion" },
  { name: "Peacebird", iso: "CN", sector: "fashion" },
  { name: "Heilan Home", iso: "CN", sector: "fashion" },
  { name: "Urban Revivo", iso: "CN", sector: "fashion" },
  { name: "Shimamura", iso: "JP", sector: "fashion" },
  { name: "Adastria", iso: "JP", sector: "fashion" },
  { name: "Muji", iso: "JP", sector: "homeware" },
  { name: "E-Land", iso: "KR", sector: "fashion" },
  { name: "Spao", iso: "KR", sector: "fashion" },
  { name: "Splash Fashions", iso: "AE", sector: "fashion" },
  { name: "Max Fashion", iso: "AE", sector: "fashion" },
  { name: "Landmark Group", iso: "AE", sector: "retail" },
  // — Denim & casual heritage
  { name: "Levi Strauss", iso: "US", sector: "denim", cambodia: true },
  { name: "Kontoor Wrangler Lee", iso: "US", sector: "denim" },
  { name: "Guess", iso: "US", sector: "fashion" },
  { name: "True Religion", iso: "US", sector: "denim" },
  { name: "Diesel", iso: "IT", sector: "denim" },
  { name: "Replay", iso: "IT", sector: "denim" },
  { name: "Pepe Jeans", iso: "ES", sector: "denim" },
  { name: "G-Star Raw", iso: "NL", sector: "denim" },
  { name: "Scotch & Soda", iso: "NL", sector: "fashion" },
  { name: "Lacoste", iso: "FR", sector: "fashion" },
  { name: "Ralph Lauren", iso: "US", sector: "fashion" },
  { name: "PVH Calvin Klein Tommy Hilfiger", iso: "US", sector: "fashion", cambodia: true },
  { name: "VF Corporation", iso: "US", sector: "fashion", cambodia: true },
  { name: "Hugo Boss", iso: "DE", sector: "fashion" },
  { name: "Superdry", iso: "GB", sector: "fashion" },
  { name: "Ted Baker", iso: "GB", sector: "fashion" },
  { name: "Fred Perry", iso: "GB", sector: "fashion" },
  { name: "Barbour", iso: "GB", sector: "fashion" },
  { name: "Nautica", iso: "US", sector: "fashion" },
  { name: "Perry Ellis", iso: "US", sector: "fashion" },
  { name: "Oxford Industries", iso: "US", sector: "fashion" },
  { name: "Tommy Bahama", iso: "US", sector: "fashion" },
  // — Underwear & basics
  { name: "Hanes", iso: "US", sector: "underwear" },
  { name: "Fruit of the Loom", iso: "US", sector: "underwear" },
  { name: "Gildan", iso: "CA", sector: "underwear" },
  { name: "Jockey", iso: "US", sector: "underwear" },
  { name: "Victoria's Secret", iso: "US", sector: "underwear" },
  { name: "Triumph International", iso: "CH", sector: "underwear" },
  { name: "Wacoal", iso: "JP", sector: "underwear" },
  { name: "Cosmo Lady", iso: "CN", sector: "underwear" },
  { name: "Aimer", iso: "CN", sector: "underwear" },
  { name: "Skims", iso: "US", sector: "underwear" },
  // — Outdoor & workwear
  { name: "Patagonia", iso: "US", sector: "outdoor" },
  { name: "The North Face", iso: "US", sector: "outdoor" },
  { name: "Columbia Sportswear", iso: "US", sector: "outdoor", cambodia: true },
  { name: "Arc'teryx", iso: "CA", sector: "outdoor" },
  { name: "Mammut", iso: "CH", sector: "outdoor" },
  { name: "Haglofs", iso: "SE", sector: "outdoor" },
  { name: "Fjallraven", iso: "SE", sector: "outdoor" },
  { name: "Jack Wolfskin", iso: "DE", sector: "outdoor" },
  { name: "Vaude", iso: "DE", sector: "outdoor" },
  { name: "Decathlon", iso: "FR", sector: "sports", cambodia: true },
  { name: "REI Co-op", iso: "US", sector: "outdoor" },
  { name: "Kathmandu", iso: "NZ", sector: "outdoor" },
  { name: "Macpac", iso: "NZ", sector: "outdoor" },
  { name: "Marmot", iso: "US", sector: "outdoor" },
  { name: "Black Diamond", iso: "US", sector: "outdoor" },
  { name: "Rab", iso: "GB", sector: "outdoor" },
  { name: "Berghaus", iso: "GB", sector: "outdoor" },
  { name: "Regatta", iso: "GB", sector: "outdoor" },
  { name: "Helly Hansen", iso: "NO", sector: "outdoor" },
  { name: "Bergans", iso: "NO", sector: "outdoor" },
  { name: "Norrona", iso: "NO", sector: "outdoor" },
  { name: "Eddie Bauer", iso: "US", sector: "outdoor" },
  { name: "L.L.Bean", iso: "US", sector: "outdoor" },
  { name: "Lands' End", iso: "US", sector: "fashion" },
  { name: "Carhartt", iso: "US", sector: "workwear" },
  { name: "Dickies", iso: "US", sector: "workwear" },
  { name: "Duluth Trading", iso: "US", sector: "workwear" },
  { name: "Engelbert Strauss", iso: "DE", sector: "workwear" },
  { name: "Snickers Workwear", iso: "SE", sector: "workwear" },
  // — Luxury & premium (apparel + leather goods)
  { name: "LVMH Louis Vuitton", iso: "FR", sector: "luxury" },
  { name: "Kering Gucci", iso: "FR", sector: "luxury" },
  { name: "Hermes", iso: "FR", sector: "luxury" },
  { name: "Chanel", iso: "FR", sector: "luxury" },
  { name: "Prada", iso: "IT", sector: "luxury" },
  { name: "Armani", iso: "IT", sector: "luxury" },
  { name: "Zegna", iso: "IT", sector: "luxury" },
  { name: "Ferragamo", iso: "IT", sector: "luxury" },
  { name: "Moncler", iso: "IT", sector: "luxury" },
  { name: "Max Mara", iso: "IT", sector: "luxury" },
  { name: "Burberry", iso: "GB", sector: "luxury" },
  { name: "Mulberry", iso: "GB", sector: "bags" },
  { name: "Tapestry Coach Kate Spade", iso: "US", sector: "bags" },
  { name: "Capri Michael Kors", iso: "US", sector: "bags" },
  { name: "Tory Burch", iso: "US", sector: "bags" },
  { name: "Furla", iso: "IT", sector: "bags" },
  { name: "Longchamp", iso: "FR", sector: "bags" },
  // — Bags & luggage
  { name: "Samsonite", iso: "US", sector: "bags" },
  { name: "Tumi", iso: "US", sector: "bags" },
  { name: "American Tourister", iso: "US", sector: "bags" },
  { name: "Rimowa", iso: "DE", sector: "bags" },
  { name: "Delsey", iso: "FR", sector: "bags" },
  { name: "Herschel Supply", iso: "CA", sector: "bags" },
  { name: "Eastpak", iso: "US", sector: "bags" },
  { name: "JanSport", iso: "US", sector: "bags" },
  { name: "Kipling", iso: "BE", sector: "bags" },
  { name: "Osprey Packs", iso: "US", sector: "bags" },
  { name: "Deuter", iso: "DE", sector: "bags" },
  { name: "Thule", iso: "SE", sector: "bags" },
  { name: "Pacsafe", iso: "HK", sector: "bags" },
  { name: "Anello", iso: "JP", sector: "bags" },
  { name: "Porter Yoshida", iso: "JP", sector: "bags" },
  { name: "Away Travel", iso: "US", sector: "bags" },
  { name: "Monos", iso: "CA", sector: "bags" },
  // — Homeware & home textiles
  { name: "IKEA", iso: "SE", sector: "homeware" },
  { name: "Williams-Sonoma", iso: "US", sector: "homeware" },
  { name: "Pottery Barn", iso: "US", sector: "homeware" },
  { name: "West Elm", iso: "US", sector: "homeware" },
  { name: "Crate & Barrel", iso: "US", sector: "homeware" },
  { name: "RH Restoration Hardware", iso: "US", sector: "homeware" },
  { name: "Wayfair", iso: "US", sector: "homeware" },
  { name: "Dunelm", iso: "GB", sector: "homeware" },
  { name: "The White Company", iso: "GB", sector: "homeware" },
  { name: "John Lewis", iso: "GB", sector: "retail" },
  { name: "Habitat", iso: "GB", sector: "homeware" },
  { name: "Maisons du Monde", iso: "FR", sector: "homeware" },
  { name: "La Redoute", iso: "FR", sector: "homeware" },
  { name: "JYSK", iso: "DK", sector: "homeware" },
  { name: "Sostrene Grene", iso: "DK", sector: "homeware" },
  { name: "Hema", iso: "NL", sector: "homeware" },
  { name: "Action", iso: "NL", sector: "retail" },
  { name: "Nitori", iso: "JP", sector: "homeware" },
  { name: "Daiso", iso: "JP", sector: "homeware" },
  { name: "Miniso", iso: "CN", sector: "homeware" },
  { name: "Zara Home", iso: "ES", sector: "homeware" },
  { name: "H&M Home", iso: "SE", sector: "homeware" },
  { name: "Adairs", iso: "AU", sector: "homeware" },
  { name: "Sheridan", iso: "AU", sector: "homeware" },
  { name: "Temple & Webster", iso: "AU", sector: "homeware" },
  { name: "Home Centre", iso: "AE", sector: "homeware" },
  { name: "Brooklinen", iso: "US", sector: "homeware" },
  { name: "Parachute Home", iso: "US", sector: "homeware" },
  { name: "Boll & Branch", iso: "US", sector: "homeware" },
  { name: "Casper", iso: "US", sector: "homeware" },
  // — Kids
  { name: "Carter's", iso: "US", sector: "kids" },
  { name: "Children's Place", iso: "US", sector: "kids" },
  { name: "Mothercare", iso: "GB", sector: "kids" },
  { name: "Vertbaudet", iso: "FR", sector: "kids" },
  { name: "Petit Bateau", iso: "FR", sector: "kids" },
  { name: "Jacadi", iso: "FR", sector: "kids" },
  { name: "Mayoral", iso: "ES", sector: "kids" },
  { name: "Chicco", iso: "IT", sector: "kids" },
  // — Department stores & big retail (private label)
  { name: "Target apparel", iso: "US", sector: "retail", cambodia: true },
  { name: "Walmart apparel", iso: "US", sector: "retail", cambodia: true },
  { name: "Costco Kirkland", iso: "US", sector: "retail" },
  { name: "TJX", iso: "US", sector: "retail" },
  { name: "Ross Stores", iso: "US", sector: "retail" },
  { name: "Macy's", iso: "US", sector: "retail" },
  { name: "Nordstrom", iso: "US", sector: "retail" },
  { name: "Kohl's", iso: "US", sector: "retail" },
  { name: "JCPenney", iso: "US", sector: "retail" },
  { name: "Dillard's", iso: "US", sector: "retail" },
  { name: "El Corte Ingles", iso: "ES", sector: "retail" },
  { name: "Galeries Lafayette", iso: "FR", sector: "retail" },
  { name: "Selfridges", iso: "GB", sector: "retail" },
  { name: "Myer", iso: "AU", sector: "retail" },
  { name: "David Jones", iso: "AU", sector: "retail" },
  { name: "Kmart Australia", iso: "AU", sector: "retail" },
  { name: "Big W", iso: "AU", sector: "retail" },
  { name: "Lotte Shopping", iso: "KR", sector: "retail" },
  { name: "Shinsegae", iso: "KR", sector: "retail" },
  { name: "Isetan Mitsukoshi", iso: "JP", sector: "retail" },
  { name: "Takashimaya", iso: "JP", sector: "retail" },
  { name: "Aeon", iso: "JP", sector: "retail" },
  { name: "Falabella", iso: "CL", sector: "retail" },
  { name: "Liverpool", iso: "MX", sector: "retail" },
  { name: "Coppel", iso: "MX", sector: "retail" },
  { name: "Lojas Renner", iso: "BR", sector: "retail" },
  { name: "Riachuelo", iso: "BR", sector: "retail" },
  { name: "Marisa", iso: "BR", sector: "retail" },
  { name: "Woolworths SA", iso: "ZA", sector: "retail" },
  { name: "Mr Price", iso: "ZA", sector: "retail" },
  { name: "Truworths", iso: "ZA", sector: "retail" },
  { name: "TFG Foschini", iso: "ZA", sector: "retail" },
  { name: "Pepkor", iso: "ZA", sector: "retail" },
  { name: "Myntra", iso: "IN", sector: "retail" },
  { name: "Reliance Trends", iso: "IN", sector: "retail" },
  { name: "Aditya Birla Fashion", iso: "IN", sector: "fashion" },
  { name: "Tata Trent Westside", iso: "IN", sector: "retail" },
  // — Sports retail (private label + supplier influence)
  { name: "JD Sports", iso: "GB", sector: "retail" },
  { name: "Foot Locker", iso: "US", sector: "retail" },
  { name: "Dick's Sporting Goods", iso: "US", sector: "retail" },
  { name: "Sports Direct Frasers", iso: "GB", sector: "retail" },
  { name: "Intersport", iso: "CH", sector: "retail" },
  { name: "XXL Sport", iso: "NO", sector: "retail" },
];

export function brandSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
export function isoCountry(iso: string): string {
  try {
    return regionNames.of(iso.toUpperCase()) ?? iso;
  } catch {
    return iso;
  }
}

/** ISO-3166 alpha-2 → flag emoji. */
export function isoToFlag(iso: string): string {
  if (!/^[A-Za-z]{2}$/.test(iso)) return "🏳️";
  return String.fromCodePoint(...[...iso.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

/** Keyless queries per brand: AI adoption, digital sourcing, and CSR/supplier moves. */
const QUERIES = (b: string) => [
  `"${b}" AI supply chain manufacturing`,
  `"${b}" artificial intelligence digital sourcing factory`,
  `"${b}" suppliers sustainability CSR traceability audit`,
];

/** Compact fallback deep-search links (shown small under the profile). */
export function contactLinks(name: string): { label: string; url: string }[] {
  const q = encodeURIComponent(name);
  return [
    { label: "🔎 verify PR contact", url: `https://www.google.com/search?q=${q}+press+office+media+contact` },
    { label: "💼 LinkedIn sourcing people", url: `https://www.linkedin.com/search/results/people/?keywords=${q}%20sourcing%20manager` },
    { label: "🇰🇭 Cambodia footprint", url: `https://www.google.com/search?q=${q}+Cambodia+factory+supplier` },
  ];
}

/* ---------------- Brand profile (at-a-glance intel) ----------------
 * One Gemini call per brand, generated once and kept (companies change
 * slowly): what it is, who owns it, top managers, and the most PUBLIC
 * contactable method (press email / media hub / contact page). The model is
 * told to omit rather than guess — an invented email is worse than none. */

export type BrandProfile = {
  about: string;
  ownership: string;
  keyPeople: { name: string; role: string }[];
  contactMethod: string;
  contactValue: string;
  contactNote: string;
};

const PROFILE_CAP = 60; // profiles generated per scout run (backfill clears in days)

async function writeProfile(ai: GoogleGenAI, b: { name: string; hq: string; sector: string }): Promise<BrandProfile> {
  const prompt = `Brand intelligence card for a B2B sales team. Company: "${b.name}" (${b.sector}; HQ ${b.hq}).

From your knowledge, give:
- about: 1-2 sentences — what the company is, its main labels/positioning.
- ownership: 1-2 sentences — parent group, controlling shareholder(s), listed exchange if public. Only what is well known.
- keyPeople: up to 6 of the top managers you are confident about (CEO, CFO, chair; include supply-chain/sourcing/sustainability executives if known). Use {name, role}.
- contactMethod: the MOST PUBLIC corporate contact route — one of "press email", "media hub", "contact page", "corporate site", "unknown".
- contactValue: the email address or URL for that route. STRICT: only if publicly well known — NEVER invent or guess an email; if unsure use the brand's most likely official domain root (e.g. https://www.example.com) and say so in contactNote, or method "unknown".
- contactNote: one sentence of practical guidance (e.g. "press office responds to media requests; route partnership asks via the contact form").

If you genuinely don't know a field, return an empty string / empty list rather than guessing.`;

  const resp = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          about: { type: Type.STRING },
          ownership: { type: Type.STRING },
          keyPeople: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: { name: { type: Type.STRING }, role: { type: Type.STRING } },
              required: ["name", "role"],
            },
          },
          contactMethod: { type: Type.STRING },
          contactValue: { type: Type.STRING },
          contactNote: { type: Type.STRING },
        },
        required: ["about", "ownership", "keyPeople", "contactMethod", "contactValue", "contactNote"],
      },
    },
  });
  return JSON.parse(resp.text ?? "{}") as BrandProfile;
}

/* ---------------- Hiring info (tab 2: Hiring & CV) ---------------- */

export type HiringInfo = {
  summary: string;
  careersUrl: string;
  hiringContact: string;
  note: string;
};

async function writeHiring(ai: GoogleGenAI, b: { name: string; hq: string; sector: string }): Promise<HiringInfo> {
  const prompt = `Recruitment intelligence for company "${b.name}" (${b.sector}; HQ ${b.hq}).

From your knowledge, give:
- summary: 1-2 sentences — their typical recruitment focus (departments, hub cities) if well known.
- careersUrl: the official careers/jobs portal URL if well known (root careers page only — never invent deep paths). Empty if unsure.
- hiringContact: ONLY a publicly known recruitment email address (e.g. careers@…). NEVER guess or construct one; most large brands accept applications only through their portal — in that case return empty.
- note: one practical sentence on how a CV/application actually reaches them (portal, LinkedIn Easy Apply, agency, email).

Omit anything you are not confident about — empty string beats a guess.`;

  const resp = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          careersUrl: { type: Type.STRING },
          hiringContact: { type: Type.STRING },
          note: { type: Type.STRING },
        },
        required: ["summary", "careersUrl", "hiringContact", "note"],
      },
    },
  });
  return JSON.parse(resp.text ?? "{}") as HiringInfo;
}

/** Generate hiring info for brands that don't have it yet (up to `max`). */
export async function backfillHiring(max = PROFILE_CAP): Promise<{ written: number; errors: string[] }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { written: 0, errors: ["GEMINI_API_KEY not set"] };
  const ai = new GoogleGenAI({ apiKey });
  const { getDb } = await import("./mongo");
  const db = await getDb();
  const col = db.collection("brands");
  const missing = await col
    .find({ hiring: { $exists: false } }, { projection: { name: 1, hq: 1, sector: 1 } })
    .sort({ score: -1 })
    .limit(max)
    .toArray();
  const errors: string[] = [];
  let written = 0;
  await mapLimit(missing, 4, async (b) => {
    try {
      const hiring = await writeHiring(ai, { name: b.name as string, hq: (b.hq as string) ?? "", sector: (b.sector as string) ?? "" });
      await col.updateOne({ _id: b._id } as never, { $set: { hiring, hiringAt: Date.now() } });
      written++;
    } catch (e) {
      errors.push(`hiring ${b.name}: ${(e as Error).message}`);
    }
  });
  return { written, errors };
}

/** Hiring-tab deep-search links. */
export function hiringLinks(name: string): { label: string; url: string }[] {
  const q = encodeURIComponent(name);
  return [
    { label: "📋 LinkedIn jobs", url: `https://www.linkedin.com/jobs/search/?keywords=${q}` },
    { label: "🧑‍💻 careers portal", url: `https://www.google.com/search?q=${q}+careers+jobs+apply` },
    { label: "✉️ recruitment email", url: `https://www.google.com/search?q=${q}+recruitment+careers+email+submit+CV` },
    { label: "📰 recent appointments", url: `https://www.google.com/search?q=${q}+appoints+OR+hires+director&tbm=nws` },
  ];
}

/** Generate profiles for brands that don't have one yet (up to `max`). */
export async function backfillProfiles(max = PROFILE_CAP): Promise<{ written: number; errors: string[] }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { written: 0, errors: ["GEMINI_API_KEY not set"] };
  const ai = new GoogleGenAI({ apiKey });
  const { getDb } = await import("./mongo");
  const db = await getDb();
  const col = db.collection("brands");
  const missing = await col
    .find({ profile: { $exists: false } }, { projection: { name: 1, hq: 1, sector: 1 } })
    .sort({ score: -1 })
    .limit(max)
    .toArray();
  const errors: string[] = [];
  let written = 0;
  await mapLimit(missing, 4, async (b) => {
    try {
      const profile = await writeProfile(ai, { name: b.name as string, hq: (b.hq as string) ?? "", sector: (b.sector as string) ?? "" });
      await col.updateOne({ _id: b._id } as never, { $set: { profile, profileAt: Date.now() } });
      written++;
    } catch (e) {
      errors.push(`profile ${b.name}: ${(e as Error).message}`);
    }
  });
  return { written, errors };
}

/** Signal categories and how much they matter to a Yai (factory-side) sale. */
export const CATEGORY_WEIGHT: Record<string, number> = {
  supply_chain: 3, // AI in supply chain / logistics / production
  sourcing: 3, // supplier digitalization, sourcing tech, audits
  esg: 2, // ESG / traceability / compliance digitalization
  automation: 2, // factory automation, robotics
  design: 2, // AI in design/product development (4DP angle)
  investment: 2, // AI investments, acquisitions, partnerships
  hiring: 2, // AI leadership/team hires
  retail_ai: 1, // customer-facing AI (chatbots, try-on) — weak signal
  other: 0.5,
};

const MODEL = "gemini-2.5-flash";
const JUDGE_BATCH = 30;
const MAX_JUDGE = 600; // new stories judged per run (backlog clears across runs)
const DOSSIER_CAP = 15; // dossiers (re)generated per run
const PER_QUERY = 6; // stories taken per RSS query
const YEAR_MS = 365 * 24 * 3600 * 1000;

const parser = new Parser({ timeout: 15000 });

function stripHtml(s: string): string {
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function splitTitleSource(raw: string): { title: string; source: string } {
  const i = raw.lastIndexOf(" - ");
  if (i > 20) return { title: raw.slice(0, i).trim(), source: raw.slice(i + 3).trim() };
  return { title: raw.trim(), source: "" };
}

type RawStory = {
  url: string; title: string; source: string; summary: string;
  brand: string; brandSlug: string; publishedAt: number;
};

async function fetchBrandStories(brand: string): Promise<RawStory[]> {
  const out: RawStory[] = [];
  const cutoff = Date.now() - YEAR_MS;
  for (const q of QUERIES(brand)) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
    const feed = await parser.parseURL(url);
    for (const it of feed.items.slice(0, PER_QUERY)) {
      if (!it.link) continue;
      const publishedAt = it.isoDate ? Date.parse(it.isoDate) : (it.pubDate ? Date.parse(it.pubDate) : Date.now());
      if (Number.isFinite(publishedAt) && publishedAt < cutoff) continue;
      const { title, source } = splitTitleSource(it.title || "");
      if (!title) continue;
      out.push({
        url: it.link, title,
        source: (it as { source?: string }).source || source || "Google News",
        summary: stripHtml(it.contentSnippet || it.content || "").slice(0, 240),
        brand, brandSlug: brandSlug(brand),
        publishedAt: Number.isFinite(publishedAt) ? publishedAt : Date.now(),
      });
    }
  }
  return out;
}

type Verdict = { signal: boolean; category: string; strength: number; note: string };

/** One batched Gemini call: classify stories as AI-adoption signals. */
async function judgeStories(ai: GoogleGenAI, stories: RawStory[]): Promise<Verdict[]> {
  const list = stories
    .map((s, i) => `#${i} [${s.brand}] ${s.title} — ${s.summary || "(no summary)"}`)
    .join("\n");
  const prompt = `You are scouting apparel/garment BRANDS for evidence they are adopting AI — to prioritise them as prospects for an AI manufacturing platform sold to their supplier factories.

For EACH story below decide:
- signal: true only if the story is real evidence THAT BRAND is investing in / adopting / mandating AI or digital technology (supply chain, sourcing, factories, ESG/traceability, design, automation, AI hires or investments). false if it's about a different company, generic industry chatter, stock commentary, or the brand is only mentioned in passing.
- category: one of supply_chain, sourcing, esg, automation, design, investment, hiring, retail_ai, other.
- strength: 1 = mention/intent, 2 = concrete initiative or pilot, 3 = major commitment (rollout, acquisition, mandate to suppliers).
- note: one short sentence a salesperson can read (max 140 chars).

Return exactly ${stories.length} items in order.

STORIES:
${list}`;

  const resp = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            signal: { type: Type.BOOLEAN },
            category: { type: Type.STRING },
            strength: { type: Type.INTEGER },
            note: { type: Type.STRING },
          },
          required: ["signal", "category", "strength", "note"],
        },
      },
    },
  });
  const arr = JSON.parse(resp.text ?? "[]") as Verdict[];
  if (!Array.isArray(arr) || arr.length !== stories.length) throw new Error("judge: bad response shape");
  return arr;
}

/** Compact Yai context fed to the dossier writer. */
const YAI_CONTEXT = `Yai (yaikh.com) is an Ai-Native Manufacturing Intelligence Platform by Texlink Technologies, Cambodia — built for garment/footwear/bag factories. Ladder: $120/yr digital admin core → cloud tiers → on-prem Ai server → agentic agents → multi-factory Ai. Killer demos: agent chat that produces a WRAP audit pack from live factory data in one conversation; Digital Audit module (energy/air/water/waste/chemical, Ministry of Environment collaboration); trilingual EN/中文/ខ្មែរ; Cambodia regulatory stack (E-Gov, e-invoice, GDT tax, ABA/Wing payouts); live in production factories (Yorkmars, Caswell). Partners: Anthropic, Google Cloud, JICA. The BRAND does not buy Yai — the brand endorses/prefers digitally-auditable suppliers, and its supplier factories in Cambodia buy Yai.`;

type Dossier = {
  whyNow: string;
  cambodiaAngle: string;
  targetRoles: string[];
  hook: string;
  opener: string;
  modules: string[];
  firstContact: string;
};

async function writeDossier(
  ai: GoogleGenAI,
  brand: { name: string; hq: string; cambodia: boolean },
  signals: { title: string; category: string; strength: number; note: string; publishedAt: number }[],
): Promise<Dossier> {
  const sigList = signals
    .map((s) => `- [${s.category} ×${s.strength}] ${s.title} (${new Date(s.publishedAt).toISOString().slice(0, 10)}) — ${s.note}`)
    .join("\n");
  const prompt = `${YAI_CONTEXT}

BRAND: ${brand.name} (HQ: ${brand.hq}; ${brand.cambodia ? "known to source from Cambodia" : "Cambodia sourcing unconfirmed"}).

Their recent AI signals:
${sigList}

Write an approach dossier for the Yai sales team. Be specific to THIS brand's signals — no generic filler. Fields:
- whyNow: 1-2 sentences — what in their signals makes this the right moment.
- cambodiaAngle: 1-2 sentences — how their Cambodia/Asia supplier base connects to Yai (if sourcing unconfirmed, say what to verify first).
- targetRoles: 3-4 job titles to contact (regional/sourcing/compliance side, not global CEO).
- hook: the single strongest bridge between their AI agenda and Yai (1 sentence).
- opener: a 2-3 sentence cold-outreach opener referencing their actual initiative. Professional, no hype, no "I hope this finds you well".
- modules: 2-4 Yai modules most relevant to pitch (e.g. Digital Audit, YQMS, YPI, 4DP, Accounting/GDT).
- firstContact: 2-3 sentences — which DOOR to knock first for this brand (PR/press office, a named LinkedIn role, the CSR/sustainability team, or a live job posting that signals the initiative) and why that door, given their signals. Include the exact search phrase to find the person.`;

  const resp = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          whyNow: { type: Type.STRING },
          cambodiaAngle: { type: Type.STRING },
          targetRoles: { type: Type.ARRAY, items: { type: Type.STRING } },
          hook: { type: Type.STRING },
          opener: { type: Type.STRING },
          modules: { type: Type.ARRAY, items: { type: Type.STRING } },
          firstContact: { type: Type.STRING },
        },
        required: ["whyNow", "cambodiaAngle", "targetRoles", "hook", "opener", "modules", "firstContact"],
      },
    },
  });
  return JSON.parse(resp.text ?? "{}") as Dossier;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Recompute a brand's score from its signals (recency-weighted, last 365d). */
function scoreSignals(signals: { category: string; strength: number; publishedAt: number }[]): number {
  const now = Date.now();
  let score = 0;
  for (const s of signals) {
    const age = Math.max(0, now - s.publishedAt);
    if (age > YEAR_MS) continue;
    const recency = 1 - (age / YEAR_MS) * 0.6; // fresh ≈ 1.0, year-old ≈ 0.4
    score += (CATEGORY_WEIGHT[s.category] ?? 0.5) * s.strength * recency;
  }
  return Math.round(score * 10) / 10;
}

export async function scoutBrands(): Promise<{
  brands: number; stories: number; newSignals: number; dossiers: number; profiles: number; errors: string[];
}> {
  const { getDb } = await import("./mongo");
  const db = await getDb();
  const sigCol = db.collection("brand_signals");
  const brandCol = db.collection("brands");
  await sigCol.createIndex({ url: 1 }, { unique: true }).catch(() => {});
  await sigCol.createIndex({ brandSlug: 1, publishedAt: -1 }).catch(() => {});

  const errors: string[] = [];

  // Ensure every seed brand has a doc (idempotent; keeps status/notes).
  const now = Date.now();
  for (const b of BRANDS) {
    await brandCol.updateOne(
      { _id: brandSlug(b.name) } as never,
      {
        $setOnInsert: { name: b.name, status: "new", notes: "", createdAt: now },
        $set: { iso: b.iso, hq: isoCountry(b.iso), sector: b.sector, cambodia: !!b.cambodia },
      },
      { upsert: true },
    );
  }

  // 1. Harvest.
  const perBrand = await mapLimit(BRANDS, 6, async (b) => {
    try {
      return await fetchBrandStories(b.name);
    } catch (e) {
      errors.push(`${b.name}: ${(e as Error).message}`);
      return [] as RawStory[];
    }
  });
  const byUrl = new Map<string, RawStory>();
  for (const list of perBrand) for (const s of list) if (!byUrl.has(s.url)) byUrl.set(s.url, s);
  const stories = [...byUrl.values()];

  // 2. Judge only URLs we've never seen (re-runs are free).
  const known = new Set(
    (await sigCol.find({ url: { $in: stories.map((s) => s.url) } }, { projection: { url: 1 } }).toArray()).map(
      (d) => d.url as string,
    ),
  );
  const fresh = stories.filter((s) => !known.has(s.url)).slice(0, MAX_JUDGE);

  let newSignals = 0;
  const apiKey = process.env.GEMINI_API_KEY;
  const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
  for (let start = 0; start < fresh.length; start += JUDGE_BATCH) {
    const batch = fresh.slice(start, start + JUDGE_BATCH);
    let verdicts: Verdict[];
    try {
      if (!ai) throw new Error("GEMINI_API_KEY not set");
      verdicts = await judgeStories(ai, batch);
    } catch (e) {
      errors.push(`judge @${start}: ${(e as Error).message}`);
      continue; // unjudged stories stay unknown → retried next run
    }
    const ops = batch.map((s, i) => ({
      insertOne: {
        document: {
          ...s,
          signal: verdicts[i].signal,
          category: verdicts[i].category,
          strength: Math.min(3, Math.max(1, verdicts[i].strength || 1)),
          note: verdicts[i].note?.slice(0, 200) ?? "",
          createdAt: now,
        },
      },
    }));
    try {
      await sigCol.bulkWrite(ops as never, { ordered: false });
    } catch { /* duplicate URLs racing — fine */ }
    newSignals += verdicts.filter((v) => v.signal).length;
  }

  // 3. Rescore every brand from its stored signals.
  for (const b of BRANDS) {
    const slug = brandSlug(b.name);
    const sigs = await sigCol
      .find({ brandSlug: slug, signal: true }, { projection: { category: 1, strength: 1, publishedAt: 1 } })
      .toArray();
    await brandCol.updateOne(
      { _id: slug } as never,
      {
        $set: {
          score: scoreSignals(sigs as never),
          signalCount: sigs.length,
          lastSignalAt: sigs.length ? Math.max(...sigs.map((s) => s.publishedAt as number)) : null,
          updatedAt: now,
        },
      },
    );
  }

  // 4. Dossiers for the hottest brands whose dossier is stale (new signals since).
  let dossiers = 0;
  if (ai) {
    const hot = await brandCol
      .find({ score: { $gt: 0 } })
      .sort({ score: -1 })
      .limit(20)
      .toArray();
    for (const b of hot) {
      if (dossiers >= DOSSIER_CAP) break;
      if (b.dossierAt && b.lastSignalAt && b.dossierAt > b.lastSignalAt) continue; // up to date
      const sigs = await sigCol
        .find({ brandSlug: b._id, signal: true })
        .sort({ strength: -1, publishedAt: -1 })
        .limit(8)
        .toArray();
      if (!sigs.length) continue;
      try {
        const dossier = await writeDossier(
          ai,
          { name: b.name as string, hq: b.hq as string, cambodia: !!b.cambodia },
          sigs as never,
        );
        await brandCol.updateOne({ _id: b._id } as never, { $set: { dossier, dossierAt: Date.now() } });
        dossiers++;
      } catch (e) {
        errors.push(`dossier ${b.name}: ${(e as Error).message}`);
      }
    }
  }

  // 5. Brand profiles + hiring info for brands still missing them.
  const prof = await backfillProfiles(PROFILE_CAP);
  errors.push(...prof.errors);
  const hire = await backfillHiring(PROFILE_CAP);
  errors.push(...hire.errors);

  return { brands: BRANDS.length, stories: stories.length, newSignals, dossiers, profiles: prof.written + hire.written, errors };
}
