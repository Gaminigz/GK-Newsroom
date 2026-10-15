/**
 * 30+DA demo accounts MADE on the admin page (owner 2026-10-14: "I need loaded 2 users with 4 photos each etc, login
 * code 5566 7788 — 1 woman 1 man"). "Use as review account" (src/lib/thirtyda-review.mjs) turns an EXISTING profile
 * into a review account; "Create demo account" here makes a NEW, fully filled one directly as a review account:
 *
 *   - Two presets (DEMO_PRESETS): "Demo woman" (Sreypov, PIN 5566, +855 10 000 5566) and "Demo man" (Samnang, PIN 7788,
 *     +855 10 000 7788). The admin can change every field before Create: app name, real name (shown at Level 3),
 *     gender, birth year (30+), job, language, mock number, PIN. Checked with the app's own rules (shared/rules.js).
 *   - Idempotent: users.demoPreset ('woman' | 'man') marks the account a preset made, so creating "Demo woman" again
 *     UPDATES that same account (its fields and its photos), never a second one.
 *   - It is a review account in every way: makeReviewAccount sets the mock number (verified, phoneVia 'review'), the
 *     PIN (hashed like the app's, sealed for the notes) and a pinned Phnom Penh spot; it joins the review world (sees
 *     the other review accounts, real people never see it), counts toward REVIEW_MAX, signs in with its PIN while
 *     "Review sign-in" is ON, and the notes list it. Remove is the admin's one delete path; "Stop being a review
 *     account" is refused for it (it has no profile of its own to go back to: it would only become a real-world ghost).
 *   - 4 photos, slot-aligned (photo 1 = the face Nearby shows), put into the normal photo store (savePhoto: re-encoded,
 *     EXIF stripped; GridFS when THIRTYDA_PHOTO_STORE=mongo) and APPROVED at once (no users.photoReview entry: the admin
 *     made them). Each slot uses the Media Director's file when it is in DEMO_PHOTO_DIR (demoPhotoFile: demo-w-1.jpg …
 *     demo-w-4.jpg, demo-m-1.jpg … demo-m-4.jpg), else a placeholder made here (a flat navy / grey silhouette, clearly
 *     not a real person). users.demoPhotos says which kind each slot has; "Refresh photos" (refreshDemoPhotos) puts the
 *     files in once they are added.
 *
 * Pure apart from the `d` (Mongo Db), the photo store and the folder handed in, so the unit tests run without them.
 */

import { readFile, access } from "node:fs/promises";
import sharp from "sharp";
import { savePhoto, deletePhoto, isPhotoId, PhotoError } from "./thirtyda-photos.mjs";
import {
  REVIEW, REVIEW_MAX, ReviewError, isReview, makeReviewAccount, reviewPinOf, reviewPinInUse, pinInUse,
} from "./thirtyda-review.mjs";
import { checkNewPin } from "./thirtyda-pin.mjs";
import { keyReady } from "./thirtyda-settings.mjs";
import { nextId, normalizePhone } from "./thirtyda-app.mjs";
import {
  LANGS, LANG_ENGLISH, PHOTO_MAX, checkAppName, checkRealName, checkBirthYear, NAME_MIN, NAME_MAX, AGE_MIN,
} from "../thirtyda-app/shared/rules.js";
import { ROLES } from "../thirtyda-app/shared/questions.js";

const USERS = "thirtyda_users";
const GENDERS = ["woman", "man", "other"];

/** The two presets the admin page offers (owner 2026-10-14: "1 woman 1 man", PINs 5566 / 7788). */
export const DEMO_PRESETS = Object.freeze({
  woman: Object.freeze({
    preset: "woman", label: "Demo woman", file: "w",
    name: "Sreypov", realName: "Heng Sreypov", gender: "woman", birthYear: 1991, role: "accountant", lang: "en",
    phone: "+855100005566", pin: "5566",
  }),
  man: Object.freeze({
    preset: "man", label: "Demo man", file: "m",
    name: "Samnang", realName: "Keo Samnang", gender: "man", birthYear: 1988, role: "civil_engineering", lang: "en",
    phone: "+855100007788", pin: "7788",
  }),
});
export const DEMO_PRESET_KEYS = Object.keys(DEMO_PRESETS);
/** A real preset key only ("woman" / "man"): never a name every object has, like "constructor" or "__proto__". */
export const isDemoPreset = (preset) => typeof preset === "string" && Object.hasOwn(DEMO_PRESETS, preset);

/** Where the Media Director's photos go (in the repo; never served as files: they go through the photo store). */
export const DEMO_PHOTO_DIR = new URL("../thirtyda-admin/review/", import.meta.url);
export const DEMO_PHOTO_DIR_NAME = "src/thirtyda-admin/review/";
/** "woman", 1 → "demo-w-1.jpg" (slot 1 = the face). */
export const demoPhotoFile = (preset, slot) => `demo-${isDemoPreset(preset) ? DEMO_PRESETS[preset].file : "x"}-${slot}.jpg`;
export const DEMO_REAL = "real";
export const DEMO_PLACEHOLDER = "placeholder";

const exists = (url) => access(url).then(() => true, () => false);

/** Which of a preset's 4 files are in `dir` → { files, real: [bool ×4], count, of }. */
export async function demoPhotoFiles(preset, { dir = DEMO_PHOTO_DIR } = {}) {
  const files = Array.from({ length: PHOTO_MAX }, (_, i) => demoPhotoFile(preset, i + 1));
  const real = await Promise.all(files.map((f) => exists(new URL(f, dir))));
  return { files, real, count: real.filter(Boolean).length, of: PHOTO_MAX };
}

// ---------------------------------------------------------------- the placeholders

const W = 720;
const H = 900;
// Four calm scenes, one per slot: 1 = head and shoulders (the face slot), 2 = a little further away, 3 = outdoors,
// 4 = at a café table. hy / r: the head's centre and radius.
const SCENES = [
  { bg: ["#24365c", "#0b1c3f"], fill: "#c9d1dc", hair: "#a3aec0", cx: 360, hy: 340, r: 108 },
  { bg: ["#4a5a76", "#22304a"], fill: "#d5dbe4", hair: "#adb7c7", cx: 360, hy: 400, r: 82, ground: { y: H - 220, fill: "#1b2740" } },
  { bg: ["#6c7b93", "#34435c"], fill: "#e1e6ed", hair: "#b8c1cf", cx: 270, hy: 450, r: 68, sun: true, ground: { y: H - 210, fill: "#2a3851" } },
  { bg: ["#33435f", "#141f36"], fill: "#bfc8d4", hair: "#98a4b6", cx: 420, hy: 420, r: 76, table: true },
];

const n1 = (v) => Math.round(v * 10) / 10;

/** One flat figure: rounded shoulders, (long hair for a woman, short for anyone else), a neck and a round head. */
function figure({ cx, hy, r, fill, hair, woman }) {
  const x = (k) => n1(cx + k * r);
  const y = (k) => n1(hy + k * r);
  const w = woman ? 1.85 : 2.15;
  const out = [
    `<path d="M${x(-w)} ${H + 10} L${x(-w)} ${y(2.4)} C${x(-w)} ${y(1.6)} ${x(-0.9)} ${y(1.25)} ${cx} ${y(1.25)} `
      + `C${x(0.9)} ${y(1.25)} ${x(w)} ${y(1.6)} ${x(w)} ${y(2.4)} L${x(w)} ${H + 10} Z" fill="${fill}"/>`,
  ];
  if (woman) {
    out.push(`<path d="M${x(-1.06)} ${y(0)} C${x(-1.12)} ${y(-1.42)} ${x(1.12)} ${y(-1.42)} ${x(1.06)} ${y(0)} `
      + `L${x(1.22)} ${y(1.85)} Q${cx} ${y(2.1)} ${x(-1.22)} ${y(1.85)} Z" fill="${hair}"/>`);
  }
  out.push(`<rect x="${x(-0.34)}" y="${y(0.7)}" width="${n1(0.68 * r)}" height="${n1(0.62 * r)}" fill="${fill}"/>`);
  out.push(`<circle cx="${cx}" cy="${hy}" r="${r}" fill="${fill}"/>`);
  if (!woman) {
    out.push(`<path d="M${x(-1.0)} ${y(-0.12)} C${x(-1.06)} ${y(-1.3)} ${x(1.06)} ${y(-1.3)} ${x(1.0)} ${y(-0.12)} `
      + `C${x(0.86)} ${y(-0.62)} ${x(-0.86)} ${y(-0.62)} ${x(-1.0)} ${y(-0.12)} Z" fill="${hair}"/>`);
  }
  return out.join("");
}

/** The SVG of placeholder `slot` (1–4) for a woman or a man (any other gender: short hair). */
export function placeholderSvg(gender, slot) {
  const sc = SCENES[(slot - 1) % SCENES.length];
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sc.bg[0]}"/><stop offset="1" stop-color="${sc.bg[1]}"/></linearGradient></defs>`,
    `<rect width="${W}" height="${H}" fill="url(#g)"/>`,
  ];
  if (sc.sun) parts.push('<circle cx="560" cy="200" r="64" fill="#eef1f6" opacity="0.5"/>');
  parts.push(figure({ ...sc, woman: gender === "woman" }));
  if (sc.ground) parts.push(`<rect y="${sc.ground.y}" width="${W}" height="${H - sc.ground.y}" fill="${sc.ground.fill}"/>`);
  if (sc.table) {
    parts.push(`<rect y="${H - 250}" width="${W}" height="250" fill="#101a2e"/>`);
    parts.push(`<rect y="${H - 262}" width="${W}" height="24" rx="4" fill="#56657e"/>`);
    parts.push(`<path d="M150 ${H - 330} h64 v52 a14 14 0 0 1 -14 14 h-36 a14 14 0 0 1 -14 -14 Z" fill="#e6eaf0" opacity="0.85"/>`);
  }
  parts.push("</svg>");
  return parts.join("");
}

/** Placeholder `slot` as JPEG bytes. */
export async function placeholderPhoto(gender, slot) {
  return sharp(Buffer.from(placeholderSvg(gender, slot))).jpeg({ quality: 86 }).toBuffer();
}

/**
 * The 4 photos of a preset, slot order: the Media Director's file where it is in `dir`, else a placeholder for the
 * account's gender. → [{ buf, kind: 'real' | 'placeholder', file }] ×4.
 */
export async function demoPhotoBuffers(preset, gender, { dir = DEMO_PHOTO_DIR } = {}) {
  const { files, real } = await demoPhotoFiles(preset, { dir });
  return Promise.all(files.map(async (file, i) => (real[i]
    ? { buf: await readFile(new URL(file, dir)), kind: DEMO_REAL, file }
    : { buf: await placeholderPhoto(gender, i + 1), kind: DEMO_PLACEHOLDER, file })));
}

/** Put the 4 photos into the photo store. All or nothing: one that fails removes the ones already saved. → ids, kinds. */
async function storeDemoPhotos(list, { save, remove }) {
  const ids = [];
  try {
    for (const p of list) {
      try {
        ids.push(await save(p.buf));
      } catch (err) {
        if (err instanceof PhotoError && p.kind === DEMO_REAL) {
          throw new ReviewError(422, "bad_photo", `${p.file} is not a photo we can read. Replace it in ${DEMO_PHOTO_DIR_NAME}.`);
        }
        throw err;
      }
    }
  } catch (err) {
    await Promise.all(ids.map((id) => remove(id)));
    throw err;
  }
  return { ids, kinds: list.map((p) => p.kind) };
}

// ---------------------------------------------------------------- the fields

const bad = (message, field) => Object.assign(new ReviewError(422, "bad_field", message), { field });

/** The admin's form → checked fields (the app's own rules), or 422 bad_field with a plain line. */
export function checkDemoFields(preset, input = {}, { now = Date.now() } = {}) {
  if (!isDemoPreset(preset)) throw new ReviewError(400, "bad_preset", "Choose Demo woman or Demo man.");
  const base = DEMO_PRESETS[preset];
  const v = { ...base, ...Object.fromEntries(Object.entries(input).filter(([, x]) => x !== undefined && x !== null)) };
  const name = checkAppName(v.name);
  if (!name.ok) throw bad(`The app name needs ${NAME_MIN} to ${NAME_MAX} characters, and no contact detail or rude word.`, "name");
  const realName = checkRealName(v.realName);
  if (!realName.ok) throw bad("Write a first and last name (no rude word).", "realName");
  if (!GENDERS.includes(v.gender)) throw bad("Choose woman, man or other.", "gender");
  const birth = checkBirthYear(v.birthYear, now);
  if (!birth.ok) throw bad(`Choose a birth year of someone aged ${AGE_MIN} or over.`, "birthYear");
  if (!ROLES.some((r) => r.key === v.role)) throw bad("Choose a job from the list.", "role");
  if (!LANGS.includes(v.lang)) throw bad("Choose one of the five languages.", "lang");
  const phone = normalizePhone(v.phone);
  if (!phone) throw bad("That number does not look right. Write it with the country code, e.g. +855 10 000 5566.", "phone");
  const pin = checkNewPin(String(v.pin ?? ""));
  if (!pin.ok) throw bad(pin.error === "format" ? "A PIN is 4 digits." : "The app does not take that PIN (like 1111 or 1234). Choose another.", "pin");
  return {
    preset, name: name.name, realName: realName.name, gender: v.gender, birthYear: birth.year, role: v.role, lang: v.lang,
    phone, pin: pin.pin,
  };
}

const sameName = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

/** The account a preset made (null: none yet, or it is being deleted). */
export async function demoAccountOf(d, preset) {
  const u = await d.collection(USERS).findOne({ demoPreset: preset, demo: REVIEW });
  return u && !u.deleting ? u : null;
}

// ---------------------------------------------------------------- create / update / refresh

/**
 * "Create demo account" (POST /30da/admin/api/review/demo { preset, name, realName, gender, birthYear, role, lang,
 * phone, pin }). A new account when the preset has none; else that same account is updated (fields, photos, number,
 * PIN). Refuses before anything is written: bad fields (422), no lock key (503), REVIEW_MAX review accounts already
 * (409 too_many, a new one only), a number another profile has (409 phone_in_use), an app name another review account
 * has (409 name_in_use), a PIN another review account has (409 pin_in_use). → { user, created }.
 * opts (tests): save / remove (the photo store), newId, dir (the photo folder), now.
 */
export async function createDemoAccount(d, preset, input, opts = {}) {
  const { save = savePhoto, remove = deletePhoto, newId = () => nextId(d, "user"), dir = DEMO_PHOTO_DIR, now = Date.now() } = opts;
  const f = checkDemoFields(preset, input, { now });
  if (!keyReady()) throw new ReviewError(503, "no_key", "The server's lock key is missing, so the PIN cannot be kept for the notes.");
  const users = d.collection(USERS);
  const existing = await demoAccountOf(d, preset);
  const selfId = existing?._id ?? null;
  if (!existing && (await users.countDocuments({ demo: REVIEW })) >= REVIEW_MAX) {
    throw new ReviewError(409, "too_many", `There are already ${REVIEW_MAX} review accounts. Remove or stop one first.`);
  }
  if (await users.findOne({ phone: f.phone, _id: { $ne: selfId } }, { projection: { _id: 1 } })) {
    throw new ReviewError(409, "phone_in_use", "Another profile has this number. Choose another mock number.");
  }
  const others = await users.find({ demo: REVIEW, _id: { $ne: selfId } }, { projection: { name: 1 } }).toArray();
  if (others.some((o) => sameName(o.name, f.name))) {
    throw new ReviewError(409, "name_in_use", `Another review account is called ${f.name}. Choose another app name.`);
  }
  // One PIN, one review account (makeReviewAccount checks it again): asked here too, before any photo is stored.
  const clash = await reviewPinInUse(d, f.pin, selfId);
  if (clash) throw pinInUse(clash);

  const { ids, kinds } = await storeDemoPhotos(await demoPhotoBuffers(preset, f.gender, { dir }), { save, remove });
  const at = new Date(now);
  const fields = {
    name: f.name, realName: f.realName, gender: f.gender, birthYear: f.birthYear, role: f.role, lang: f.lang, language: LANG_ENGLISH[f.lang],
    photos: ids, demoPhotos: kinds,
  };
  let id = selfId;
  // The mock number (verified, phoneVia 'review'), the PIN (hashed + sealed for the notes), the pinned spot.
  const review = () => makeReviewAccount(d, id, { phone: f.phone, pin: f.pin }, { now });
  try {
    if (existing) {
      // Number and PIN first: should that fail, the account still shows its old photos (the new ones go below).
      await review();
      // Approved photos: no photoReview entry for any slot.
      await users.updateOne({ _id: id, demoPreset: preset }, { $set: { ...fields, demoAt: at }, $unset: { photoReview: "", photoReviewAt: "" } });
    } else {
      id = await newId();
      await users.insertOne({
        _id: id, id, ...fields,
        // A review account from its first moment: never in the real world, not even before its number is set.
        demo: REVIEW, demoPreset: preset, demoAt: at, reviewAt: at,
        verified: { phone: false, gmail: false, facebook: false, tiktok: false },
        location: null, area: "", city: "", hearts: { red: 0, orange: 0 }, level: 1, presence: "offline", lastSeenAt: at,
        blocked: false, blockResolved: [], notices: [], pinTries: 0, createdAt: at,
      });
      await review();
    }
  } catch (err) {
    await Promise.all(ids.map((x) => remove(x)));
    if (!existing && id) await users.deleteMany({ _id: id, demoPreset: preset });
    if (err?.code === 11000) throw new ReviewError(409, "phone_in_use", "Another profile has this number. Choose another mock number.");
    throw err;
  }
  // The photos it had before go from the store once the new ones are in place.
  if (existing) await Promise.all((existing.photos ?? []).filter((x) => isPhotoId(x) && !ids.includes(x)).map((x) => remove(x)));
  return { user: await users.findOne({ _id: id }), created: !existing };
}

/**
 * "Refresh photos" (POST /30da/admin/api/review/demo/:id/photos): a preset-made account takes the photos now in the
 * folder (the Media Director's files where they are, placeholders for the rest), approved, slot-aligned; its old
 * photos leave the store. 404 for any other profile. → the user.
 */
export async function refreshDemoPhotos(d, id, opts = {}) {
  const { save = savePhoto, remove = deletePhoto, dir = DEMO_PHOTO_DIR, now = Date.now() } = opts;
  const users = d.collection(USERS);
  const u = await users.findOne({ _id: id });
  if (!u || u.deleting || !isDemoPreset(u.demoPreset) || !isReview(u)) throw new ReviewError(404, "not_found", "This is not a demo account made on this page.");
  const { ids, kinds } = await storeDemoPhotos(await demoPhotoBuffers(u.demoPreset, u.gender, { dir }), { save, remove });
  const r = await users.updateOne(
    { _id: id, demoPreset: u.demoPreset }, { $set: { photos: ids, demoPhotos: kinds, demoAt: new Date(now) }, $unset: { photoReview: "", photoReviewAt: "" } },
  );
  if (!r.matchedCount) {
    await Promise.all(ids.map((x) => remove(x)));
    throw new ReviewError(404, "not_found", "This is not a demo account made on this page.");
  }
  await Promise.all((u.photos ?? []).filter((x) => isPhotoId(x) && !ids.includes(x)).map((x) => remove(x)));
  return users.findOne({ _id: id });
}

// ---------------------------------------------------------------- what the page shows

/**
 * The "Create demo account" panel: per preset its fields (the account's own once it exists, else the preset's), which
 * photo files are in the folder, and the account (id, PIN, which kind of photo each slot has); the job and language
 * lists for the form.
 */
export async function demoView(d, { dir = DEMO_PHOTO_DIR } = {}) {
  const presets = await Promise.all(DEMO_PRESET_KEYS.map(async (key) => {
    const p = DEMO_PRESETS[key];
    const [u, files] = await Promise.all([demoAccountOf(d, key), demoPhotoFiles(key, { dir })]);
    const kinds = Array.isArray(u?.demoPhotos) ? u.demoPhotos.slice(0, PHOTO_MAX) : [];
    return {
      preset: key, label: p.label,
      defaults: { name: p.name, realName: p.realName, gender: p.gender, birthYear: p.birthYear, role: p.role, lang: p.lang, phone: p.phone, pin: p.pin },
      files: { names: files.files, real: files.real, count: files.count, of: files.of },
      account: u ? {
        id: u._id, name: u.name ?? "", realName: u.realName ?? "", gender: u.gender ?? null, birthYear: u.birthYear ?? null,
        role: u.role ?? null, lang: u.lang ?? "en", phone: u.phoneVia === REVIEW ? u.phone ?? null : null, pin: reviewPinOf(u),
        photos: Array.isArray(u.photos) ? u.photos.slice(0, PHOTO_MAX).filter(Boolean).length : 0,
        realPhotos: kinds.filter((k) => k === DEMO_REAL).length,
        // Real files are in the folder that this account does not show yet: "Refresh photos" puts them in.
        refresh: files.real.some((r, i) => r && kinds[i] !== DEMO_REAL),
      } : null,
    };
  }));
  return {
    presets,
    folder: DEMO_PHOTO_DIR_NAME,
    roles: ROLES.map((r) => ({ key: r.key, text: r.text?.en ?? r.key })),
    langs: LANGS.map((l) => ({ key: l, text: LANG_ENGLISH[l] })),
    genders: GENDERS,
  };
}
