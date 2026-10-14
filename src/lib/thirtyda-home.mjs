/**
 * 30+DA home page photos (owner 2026-10-14), next to the page itself (src/lib/thirtyda-pages.mjs homePage):
 *
 *   homePhotos()                      which photo slots (HOME_SLOTS: hero, people-1 … people-4) have a file in
 *                                     src/thirtyda-app/home/img/ — read once per process (photos come with a deploy)
 *   GET /30da/home/img/<name>.<ext>   one photo: [a-z0-9-] names only, .jpg or .webp only, the right Content-Type,
 *                                     cached a day (sendHomeImage). Nothing else in that folder is served.
 *
 * The page shows an <img> for a slot only when its file is there, else a soft placeholder (never a stock face).
 */
import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import crypto from "node:crypto";
import { HOME_SLOTS, HOME_IMG_EXTS } from "./thirtyda-pages.mjs";

/** The folder the photos live in (its README.md names the files). */
export const HOME_IMG_DIR = new URL("../thirtyda-app/home/img/", import.meta.url);
/** /30da/home/img/<name>.<ext>: a short lower-case name, a jpg or webp. */
export const HOME_IMG_RE = /^\/30da\/home\/img\/([a-z0-9][a-z0-9-]{0,63})\.(jpg|webp)$/;
export const HOME_IMG_TYPES = Object.freeze({ jpg: "image/jpeg", webp: "image/webp" });
export const HOME_IMG_CACHE = "public, max-age=86400";

let cached = null;

/**
 * { [slot]: ['webp', 'jpg'] } — the kinds of file each slot has (slots without one are left out). Read once per
 * process for the real folder; `dir` (a test's folder) is read every time. A missing folder → {}.
 */
export function homePhotos({ dir = HOME_IMG_DIR } = {}) {
  const real = dir === HOME_IMG_DIR;
  if (real && cached) return cached;
  let files;
  try {
    files = new Set(readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name));
  } catch {
    files = new Set();
  }
  const out = {};
  for (const slot of HOME_SLOTS) {
    const exts = HOME_IMG_EXTS.filter((x) => files.has(`${slot}.${x}`));
    if (exts.length) out[slot] = exts;
  }
  if (real) cached = out;
  return out;
}

/** Forget what homePhotos() read (tests). */
export function clearHomePhotos() {
  cached = null;
}

/**
 * Send one home page photo, or a plain 404. `headers` = the app's base headers (nosniff, referrer policy); `dir` = the
 * folder (tests). The name and kind are checked again here, whatever the caller matched.
 */
export async function sendHomeImage(req, res, name, ext, { dir = HOME_IMG_DIR, headers = {} } = {}) {
  const notFound = () => res.writeHead(404, { ...headers, "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(name)) || !Object.hasOwn(HOME_IMG_TYPES, ext)) return notFound();
  let buf;
  try {
    buf = await readFile(new URL(`${name}.${ext}`, dir));
  } catch {
    return notFound();
  }
  const etag = `"${crypto.createHash("sha1").update(buf).digest("base64url")}"`;
  const head = {
    ...headers, "Content-Type": HOME_IMG_TYPES[ext], "Cache-Control": HOME_IMG_CACHE, ETag: etag, "Content-Length": buf.length,
  };
  if (req.headers?.["if-none-match"] === etag) {
    delete head["Content-Length"];
    res.writeHead(304, head).end();
    return;
  }
  res.writeHead(200, head);
  res.end(req.method === "HEAD" ? undefined : buf);
}
