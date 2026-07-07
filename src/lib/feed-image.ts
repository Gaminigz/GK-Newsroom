/**
 * Image fallback for feed items missing an RSS-embedded picture.
 *
 * Two-tier fallback:
 *   1. Fetch the article HTML and extract <meta property="og:image">.
 *      Most modern publications set this — it's the same image other
 *      social apps show when the URL is shared.
 *   2. Give up and return a data-URI SVG tile branded to the source
 *      (guarantees every card has a picture, per spec).
 *
 * Scrapes run in parallel; a per-request timeout keeps the page build
 * fast even when a source is slow.
 */

const OG_TIMEOUT_MS = 6000;

const UA =
  "Mozilla/5.0 (compatible; YaikhAiFeedBot/1.0; +https://yaikh.com/ai-feed)";

async function fetchOgImage(url: string): Promise<string | null> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), OG_TIMEOUT_MS);
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
      signal: ctl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    // Only read the head — og:image is always in <head>.
    const text = (await res.text()).slice(0, 200_000);

    const patterns: RegExp[] = [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m?.[1]) return absolutize(m[1], url);
    }
    return null;
  } catch {
    return null;
  }
}

function absolutize(maybeRelative: string, base: string): string {
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return maybeRelative;
  }
}

/**
 * Designed fallback tile — an SVG data URI, no network dependency.
 * Colour comes from a per-source palette so tiles are visually distinct.
 */
export function sourceTile(source: string): string {
  const palette: Record<string, [string, string]> = {
    "OpenAI":          ["#0F172A", "#10A37F"],
    "Google DeepMind": ["#0B2545", "#4F86F7"],
    "TechCrunch AI":   ["#0A1F47", "#00A63E"],
    "Ars Technica":    ["#1A1B1F", "#FF4E00"],
    "Wired AI":        ["#0A0A0A", "#F04E23"],
  };
  const [c1, c2] = palette[source] || ["#0A1F47", "#F37021"];
  const initials = source
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${c1}"/>
        <stop offset="1" stop-color="${c2}"/>
      </linearGradient>
    </defs>
    <rect width="800" height="500" fill="url(#g)"/>
    <text x="50%" y="52%" fill="white" font-family="Georgia, serif" font-weight="700"
          font-size="180" text-anchor="middle" opacity="0.9">${initials}</text>
    <text x="50%" y="82%" fill="white" font-family="system-ui, sans-serif"
          font-size="26" letter-spacing="4" text-anchor="middle" opacity="0.7">${source.toUpperCase()}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Fill in a picture for each item that lacks one. Runs og:image scrapes
 * in parallel, then applies the designed tile fallback for anything left.
 */
export async function ensureImages<T extends { url: string; image: string | null; source: string }>(
  items: T[]
): Promise<T[]> {
  const needs = items.filter((it) => !it.image);
  const scraped = await Promise.all(needs.map((it) => fetchOgImage(it.url)));

  const map = new Map<string, string | null>();
  needs.forEach((it, i) => map.set(it.url, scraped[i]));

  return items.map((it) => {
    if (it.image) return it;
    const og = map.get(it.url);
    return { ...it, image: og || sourceTile(it.source) };
  });
}
