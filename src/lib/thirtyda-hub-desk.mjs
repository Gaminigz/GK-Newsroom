/**
 * GK API Hub · tower 14 "Agent Desk" (owner 2026-10-16: "get this 3 service tower ready then we inform to M1 M2 Media
 * guys, use it for pull google map details, and image generation if need"). The Gemini Worker on the M1 runs one Chrome
 * with three hidden worker windows signed in to Google: TEXT (Gemini: translation, language checks, fact finding), IMAGE
 * (Gemini: make / edit pictures) and MAPS (Google Maps place lookups). Our apps (Yai Media Director, the M1 apps, the M2
 * apps) send jobs here; the worker takes them.
 *
 * Pull design, like tower 11 · Wan (src/lib/thirtyda-hub-wan.mjs): this server never calls the M1. The worker calls OUT —
 * claim / progress / done / fail — and jobs wait here meanwhile. Nothing on the M1 is opened to the internet (its own
 * API, 127.0.0.1:8806, stays M1-only).
 *
 * Rules of this tower:
 *   - NO 30+DA user data in any job: no chat lines, no profiles, no photos. 30+DA's own code never calls this hub (a test
 *     checks it); private chat translation stays on tower 13 (Hy-MT2 on the M1).
 *   - Maps answers go back to the app that asked, and nowhere else: never into our own place list
 *     (thirtyda_places_index) or the 30+DA place search (that one uses the Places API key, tower 12).
 *   - Automating Gemini / Google Maps in a browser can get the Google account suspended: the owner chose it knowing that
 *     (2026-10-16); the tower card says so.
 *
 * Contract v1 (2026-10-16). Base /30da/hub/desk (https://ecom.ggmt.sg/30da/hub/desk), JSON unless noted, every call
 * `Authorization: Bearer <token>`. Errors are { error: <code>, message, field? } like tower 11's.
 *   Client (one token per app, made on the tower: "deskm_…" Yai Media Director, "desk1_…" the M1 apps, "desk2_…" the M2
 *   apps — an app sees only its own jobs):
 *   POST /jobs  { type: "text" | "image" | "maps", input }
 *        text:  input { prompt: 1–8,000 characters, task?: "translate" | "check" | "facts" | "other" }
 *        image: input { prompt: 1–2,000 characters, image?: base64 JPEG|PNG|WebP ≤ 8 MB (a picture to edit),
 *                       aspect?: "1:1" (default) | "9:16" | "16:9" | "4:3" | "3:4" }
 *        maps:  input { query: 1–300 characters, near?: an area in words ≤ 120, lat? lng? (both or neither) }
 *        → 202 { job_id, type, status: "pending" }
 *        400 invalid {field} · 401 unauthorized · 413 too_large · 429 queue_full | storage_full | rate_limited
 *        · 503 type_off (the tower has that type off)
 *   GET  /jobs/{job_id} → 200 { job_id, type, status: "pending"|"running"|"done"|"failed", progress? 0–1,
 *        result? (done text: { text } · done maps: { places: [ … as the worker gave them ] }), url? (done image: the
 *        absolute picture URL), error? (failed: a short text), created_at, started_at?, finished_at?, expires_at? (done),
 *        expired? true (done, older than 48 h: the result is gone) } · 404 not_found (no such job, or another app's)
 *   GET  /files/{job_id} → 200 the picture (image/png | image/jpeg | image/webp) · 404 not_found · 410 expired (48 h)
 *   Worker (the Gemini Worker on the M1, the WORKER token "deskw_…"):
 *   POST /worker/claim  { worker: "M1 Agent Desk", types?: ["text","image","maps"] (what it can do now; default all),
 *        windows?: { text?, image?, maps? : "ready" | "busy" | "signed_out" | "error" | "closed" },
 *        info?: { chrome?, version? } }
 *        → 200 { job: { job_id, lease_id, type, input } } (image: input.image is base64 JPEG ≤ 1280 px, when one was sent)
 *        · 204 nothing to do. Every claim is a heartbeat (call it every ~10–20 s while idle). A claim leases the job:
 *        text and maps 10 min, image 20 min.
 *   With header X-Desk-Lease: <lease_id> from the claim (else 409 not_yours: the lease ran out and the job moved on):
 *   POST /worker/jobs/{job_id}/progress  { progress: 0–1 } → 200 (the lease starts again)
 *   POST /worker/jobs/{job_id}/done      text: { text: ≤ 20,000 characters } · maps: { places: [ ≤ 20 objects ] } (the
 *        JSON ≤ 48 KB) · image: the raw picture, Content-Type image/png | image/jpeg | image/webp, ≤ 8 MB → 200
 *   POST /worker/jobs/{job_id}/fail      { error: "short text" } → 200
 *   Progress, done and fail are heartbeats too. A lease that runs out puts the job back once; the second time it fails
 *   with "worker_lost".
 *
 * Kept: jobs in `thirtyda_hub_desk_jobs`. A text / maps job keeps its input only until it is done or failed; its result
 * 48 h after done (then cleared: expired). Pictures (an image job's input and its result) in GridFS bucket
 * `thirtyda_hub_desk` on the live server (THIRTYDA_PHOTO_STORE=mongo), else files in <repo>/.data/hub-desk/ (gitignored);
 * the input goes once the job is done or failed, the result 48 h after done. Job records go 7 days after they finished.
 * Guards for the Mongo M0 (512 MB, shared with tower 11's 150 MB): ≤ 20 jobs pending + running, ≤ 40 MB of pictures
 * kept, per app and hour ≤ 120 text, 20 image, 120 maps jobs. The caps are checked, then written: two jobs at the very
 * same moment may pass one over.
 *
 * Tower options (thirtyda_settings `desk_options`): each type On / Off (all on until turned off). The worker's last call
 * (`desk_worker_seen`: when, its name, its windows, the types it took, its info) makes the tower Live for 2 minutes.
 *
 * The admin side (src/lib/thirtyda-admin.mjs, Code page tower 14): deskAdminView, newDeskToken, revokeDeskToken,
 * saveDeskOptions, queueDeskTry, deskTryFile. A Try queues a fixed, harmless job of one type (source "try") whose
 * answer only the admin sees.
 */

import crypto from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { finished } from "node:stream/promises";
import { GridFSBucket } from "mongodb";
import { getDb } from "./mongo.ts";
import { SETTINGS_COLLECTION, checkToken, tokenStatus, makeToken, removeToken } from "./thirtyda-settings.mjs";
import { publicOrigin } from "./thirtyda-signin.mjs";
import {
  HUB_BASE, HubError, fail, invalid, tooLarge, notFound, readRaw, readJson, sendJson, sendClip, BASE_HEADERS, normalizeWanImage,
} from "./thirtyda-hub-wan.mjs";

export const DESK_BASE = `${HUB_BASE}/desk`;
export const DESK_JOBS = "thirtyda_hub_desk_jobs";
export const DESK_BUCKET = "thirtyda_hub_desk";
const OPTIONS_ID = "desk_options";
const SEEN_ID = "desk_worker_seen";
export const DESK_TYPES = ["text", "image", "maps"];
/** The apps, each with its own client token (src/lib/thirtyda-settings.mjs TOKEN_SETTINGS). */
export const DESK_APPS = Object.freeze({
  media: { setting: "desk_media", prefix: "deskm_", name: "Yai Media Director" },
  m1: { setting: "desk_m1", prefix: "desk1_", name: "M1 apps" },
  m2: { setting: "desk_m2", prefix: "desk2_", name: "M2 apps" },
});
export const DESK_WORKER = "desk_worker";

const KB = 1024;
const MB = 1024 * KB;
export const DESK_LIMITS = Object.freeze({
  jobBody: 12 * MB, // POST /jobs: the JSON (an image job's base64 picture)
  json: 64 * KB, // every other JSON body (a text / maps /done too)
  image: 8 * MB, // a picture in, decoded; a picture out
  prompt: { text: 8000, image: 2000 },
  query: 300,
  near: 120,
  resultText: 20000,
  resultMaps: 48 * KB, // the places, as JSON
  places: 20,
  error: 200,
  queue: 20, // pending + running
  storage: 40 * MB, // pictures kept (in + out)
  perHour: { text: 120, image: 20, maps: 120 }, // per app
});
export const ASPECTS = ["1:1", "9:16", "16:9", "4:3", "3:4"];
const TASKS = ["translate", "check", "facts", "other"];
const WINDOW_STATES = ["ready", "busy", "signed_out", "error", "closed"];
const PICTURE_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
export const LEASE_MS = { text: 10 * 60e3, maps: 10 * 60e3, image: 20 * 60e3 };
const ATTEMPTS_MAX = 2;
export const KEEP_MS = 48 * 3600e3;
const JOB_KEEP_MS = 7 * 24 * 3600e3;
export const LIVE_MS = 2 * 60e3;
const SWEEP_EVERY_MS = 60e3;
const HOUR_MS = 3600e3;
const JOB_ID_RE = /^[a-f0-9]{32}$/;
const ADMIN_FILES = "/30da/admin/api/connections/desk/files";
/** The admin's Try, one per type: fixed and harmless — no person's data, nothing private. */
export const DESK_TRIES = Object.freeze({
  text: { prompt: "Translate into Khmer, Chinese, Korean and Japanese: \"Good morning. See you at the café at 7.\"", task: "translate" },
  image: { prompt: "A calm watercolour of a small riverside café in Phnom Penh at sunset, no people, no text.", aspect: "1:1" },
  maps: { query: "Brown Coffee", near: "Toul Kork, Phnom Penh" },
});

// ---------------------------------------------------------------- the picture store

// <job id>.in.jpg (an image job's input) · <job id>-<lease 8>-<random 8>.out.png|jpg|webp (its result: each upload its own)
const KEY_RE = /^[a-f0-9]{32}(?:\.in\.jpg|-[a-f0-9]{8}-[a-f0-9]{8}\.out\.(?:png|jpg|webp))$/;
const keyOk = (key) => typeof key === "string" && KEY_RE.test(key);

/** In memory: the unit tests. */
export function deskMemoryStore() {
  const files = new Map();
  return {
    kind: "memory",
    files,
    async put(key, buf) { if (!keyOk(key)) throw new Error("bad key"); files.set(key, Buffer.from(buf)); },
    async get(key) { return keyOk(key) && files.has(key) ? Buffer.from(files.get(key)) : null; },
    async remove(key) { files.delete(key); },
  };
}

/** Files in a folder (dev): <repo>/.data/hub-desk/, gitignored. */
function deskFileStore(dir = new URL("../../.data/hub-desk/", import.meta.url)) {
  return {
    kind: "local",
    async put(key, buf) {
      if (!keyOk(key)) throw new Error("bad key");
      await mkdir(dir, { recursive: true });
      await writeFile(new URL(key, dir), buf);
    },
    async get(key) {
      if (!keyOk(key)) return null;
      try {
        return await readFile(new URL(key, dir));
      } catch (err) {
        if (err?.code === "ENOENT") return null;
        throw err;
      }
    },
    async remove(key) {
      if (!keyOk(key)) return;
      try { await unlink(new URL(key, dir)); } catch { /* already gone */ }
    },
  };
}

/** GridFS bucket `thirtyda_hub_desk` (the live server). The key is the file's id. Like tower 11's gridStore. */
function deskGridStore(dbFn = getDb) {
  let bucket = null;
  const grid = async () => (bucket ??= new GridFSBucket(await dbFn(), { bucketName: DESK_BUCKET }));
  return {
    kind: "mongo",
    async put(key, buf) {
      if (!keyOk(key)) throw new Error("bad key");
      const b = await grid();
      const up = b.openUploadStreamWithId(key, key);
      up.on("error", () => {});
      try {
        for (let at = 0; at < buf.length; at += up.chunkSizeBytes) {
          if (!up.write(buf.subarray(at, at + up.chunkSizeBytes))) await once(up, "drain");
        }
        up.end();
        await finished(up);
      } catch (err) {
        await b.delete(key).catch(() => {}); // no chunks left behind uncounted
        throw err;
      }
    },
    async get(key) {
      if (!keyOk(key)) return null;
      try {
        const chunks = [];
        for await (const c of (await grid()).openDownloadStream(key)) chunks.push(c);
        return Buffer.concat(chunks);
      } catch (err) {
        if (err?.code === "ENOENT" || err?.name === "MongoGridFSChunkError") return null;
        throw err;
      }
    },
    async remove(key) {
      if (!keyOk(key)) return;
      try { await (await grid()).delete(key); } catch { /* already gone */ }
    },
  };
}

// Unit tests only: an in-memory database, an in-memory store and a clock.
const testHooks = { db: null, store: null, now: null };
export function setHubDeskTestHooks({ db: d = null, store = null, now = null } = {}) {
  testHooks.db = d;
  testHooks.store = store;
  testHooks.now = now;
  lastSweep = 0;
}
const clock = () => (testHooks.now ? testHooks.now() : Date.now());

let defaultStore = null;
function deskStore() {
  if (testHooks.store) return testHooks.store;
  return (defaultStore ??= process.env.THIRTYDA_PHOTO_STORE === "mongo" ? deskGridStore() : deskFileStore());
}

let ready = null;
async function db() {
  if (testHooks.db) return testHooks.db;
  const d = await getDb();
  if (!ready) {
    const jobs = d.collection(DESK_JOBS);
    ready = Promise.all([
      jobs.createIndex({ status: 1, createdAt: 1 }),
      jobs.createIndex({ app: 1, type: 1, createdAt: 1 }),
    ]).catch((e) => { ready = null; throw e; });
  }
  await ready;
  return d;
}
const jobsOf = (d) => d.collection(DESK_JOBS);
const settingsOf = (d) => d.collection(SETTINGS_COLLECTION);
const isoOf = (t) => (t ? new Date(t).toISOString() : null);
const notYours = () => fail(409, "not_yours", "This job is no longer leased to you: the lease ran out and the job moved on.");
const oneLine = (s, max) => String(s).replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);

// ---------------------------------------------------------------- tokens

const bearer = (req) => /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(String(req.headers.authorization ?? ""))?.[1] ?? null;
const unauthorized = (what) => fail(401, "unauthorized", `Send ${what}: Authorization: Bearer <token>.`, {}, { "WWW-Authenticate": 'Bearer realm="desk"' });

/** An app's token → the app's id ('media' | 'm1' | 'm2'); its prefix says which. Else 401. */
async function authedApp(d, req) {
  const t = bearer(req);
  const app = t ? Object.keys(DESK_APPS).find((a) => t.startsWith(DESK_APPS[a].prefix)) : null;
  if (!app || !(await checkToken(d, DESK_APPS[app].setting, t))) throw unauthorized("your app's token");
  return app;
}
async function authedWorker(d, req) {
  const t = bearer(req);
  if (!t || !(await checkToken(d, DESK_WORKER, t))) throw unauthorized("the worker token");
}

// ---------------------------------------------------------------- options + the worker's heartbeat

/** Each type On / Off (on until turned off). */
export async function deskOptions(d) {
  const doc = await settingsOf(d).findOne({ _id: OPTIONS_ID });
  const types = {};
  for (const t of DESK_TYPES) types[t] = typeof doc?.types?.[t] === "boolean" ? doc.types[t] : true;
  return { types, updatedAt: isoOf(doc?.updatedAt) };
}

/** { types: { text?, image?, maps? } } → { ok, options } | { ok: false, field, error }. What is left out stays. */
export async function saveDeskOptions(d, input, { by = "superadmin" } = {}) {
  const v = input && typeof input === "object" ? input : {};
  const cur = await deskOptions(d);
  const types = { ...cur.types };
  if ("types" in v) {
    if (!v.types || typeof v.types !== "object" || Array.isArray(v.types)) return { ok: false, field: "types", error: "Pick the types." };
    for (const [t, on] of Object.entries(v.types)) {
      if (!DESK_TYPES.includes(t)) return { ok: false, field: "types", error: `No such type: ${oneLine(t, 20)}.` };
      if (typeof on !== "boolean") return { ok: false, field: "types", error: `${t}: on or off.` };
      types[t] = on;
    }
  }
  await settingsOf(d).replaceOne({ _id: OPTIONS_ID }, { _id: OPTIONS_ID, kind: "options", types, updatedAt: new Date(clock()), updatedBy: by }, { upsert: true });
  return { ok: true, options: await deskOptions(d) };
}

function workerName(v) {
  if (v == null) return "worker";
  if (typeof v !== "string" || !v.trim() || v.trim().length > 40) throw invalid("worker", 'worker: a short name, like "M1 Agent Desk".');
  return oneLine(v, 40);
}
/** The types the worker can take now (default: all). */
function workerTypes(v) {
  if (v == null) return [...DESK_TYPES];
  if (!Array.isArray(v) || v.some((t) => !DESK_TYPES.includes(t))) throw invalid("types", `types: some of ${DESK_TYPES.join(", ")}.`);
  return DESK_TYPES.filter((t) => v.includes(t));
}
function workerWindows(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out = {};
  for (const t of DESK_TYPES) if (WINDOW_STATES.includes(v[t])) out[t] = v[t];
  return out;
}
function workerInfo(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out = {};
  for (const k of ["chrome", "version"]) if (typeof v[k] === "string" && v[k].trim()) out[k] = oneLine(v[k], 60);
  return out;
}

async function noteHeartbeat(d, now, worker, more = null) {
  const set = { kind: "status", at: new Date(now), worker };
  if (more) Object.assign(set, more);
  await settingsOf(d).updateOne({ _id: SEEN_ID }, { $set: set }, { upsert: true });
}

// ---------------------------------------------------------------- jobs

const inputKey = (id) => `${id}.in.jpg`;
const outKey = (id, leaseId, ext) => `${id}-${String(leaseId).slice(0, 8)}-${crypto.randomBytes(4).toString("hex")}.out.${ext}`;

async function storedBytes(d) {
  const rows = await jobsOf(d).find({ bytes: { $gt: 0 } }, { projection: { bytes: 1 } }).toArray();
  return rows.reduce((n, j) => n + (Number(j.bytes) || 0), 0);
}
const activeCount = (d) => jobsOf(d).countDocuments({ status: { $in: ["pending", "running"] } });
const jobsThisHour = (d, app, type, now) => jobsOf(d).countDocuments({ app, type, createdAt: { $gt: new Date(now - HOUR_MS) } });

const text = (v, field, max) => {
  if (typeof v !== "string" || !v.trim()) throw invalid(field, `${field}: text.`);
  const t = v.trim();
  if (t.length > max) throw invalid(field, `${field}: at most ${max.toLocaleString("en-GB")} characters.`);
  return t;
};

/** A job's input, checked → { input (what the job keeps), picture? (the raw picture to store) }. */
function checkInput(type, v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw invalid("input", "input: an object.");
  if (type === "text") {
    const prompt = text(v.prompt, "prompt", DESK_LIMITS.prompt.text);
    const task = v.task == null ? "other" : v.task;
    if (!TASKS.includes(task)) throw invalid("task", `task: ${TASKS.join(", ")}.`);
    return { input: { prompt, task } };
  }
  if (type === "image") {
    const prompt = text(v.prompt, "prompt", DESK_LIMITS.prompt.image);
    const aspect = v.aspect == null ? "1:1" : v.aspect;
    if (!ASPECTS.includes(aspect)) throw invalid("aspect", `aspect: ${ASPECTS.join(", ")}.`);
    let picture = null;
    if (v.image != null) {
      if (typeof v.image !== "string" || !v.image.trim()) throw invalid("image", "image: a JPEG, PNG or WebP picture, base64.");
      const b64 = v.image.trim().replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "").replace(/\s+/g, "");
      if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(b64)) throw invalid("image", "image: not base64.");
      if (Math.floor((b64.length * 3) / 4) > DESK_LIMITS.image + 3) throw tooLarge("image: at most 8 MB.", "image");
      picture = Buffer.from(b64, "base64");
      if (!picture.length) throw invalid("image", "image: empty.");
      if (picture.length > DESK_LIMITS.image) throw tooLarge("image: at most 8 MB.", "image");
    }
    return { input: { prompt, aspect }, picture };
  }
  const query = text(v.query, "query", DESK_LIMITS.query);
  const input = { query };
  if (v.near != null) input.near = text(v.near, "near", DESK_LIMITS.near);
  if (v.lat != null || v.lng != null) {
    const lat = Number(v.lat);
    const lng = Number(v.lng);
    if (typeof v.lat !== "number" || typeof v.lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw invalid("lat", "lat, lng: both numbers, or neither.");
    }
    input.lat = Math.round(lat * 1e5) / 1e5;
    input.lng = Math.round(lng * 1e5) / 1e5;
  }
  return { input };
}

/** Refuses a job while its type is off or a cap is reached. `extraBytes`: a picture about to be stored. */
async function gate(d, { type, app, now, extraBytes = 0 }) {
  const options = await deskOptions(d);
  if (!options.types[type]) throw fail(503, "type_off", `${type} jobs are off on this tower.`);
  const per = DESK_LIMITS.perHour[type];
  if (app !== "try" && (await jobsThisHour(d, app, type, now)) >= per) {
    throw fail(429, "rate_limited", `At most ${per} ${type} jobs an hour for this app. Try again later.`);
  }
  if ((await activeCount(d)) >= DESK_LIMITS.queue) throw fail(429, "queue_full", `${DESK_LIMITS.queue} jobs are already waiting. Try again later.`);
  if (extraBytes && (await storedBytes(d)) + extraBytes > DESK_LIMITS.storage) {
    throw fail(429, "storage_full", "The desk is full of pictures. Try again later.");
  }
}

/** Store the picture (if any) and queue the job. → the job id. */
async function queueJob(d, store, { type, input, picture, app, source, now }) {
  const id = crypto.randomBytes(16).toString("hex");
  const pic = picture ? { key: inputKey(id), bytes: picture.length } : null;
  try {
    if (pic) await store.put(pic.key, picture);
    await jobsOf(d).insertOne({
      _id: id, type, status: "pending", source, app, input, picture: pic, result: null, file: null, bytes: pic?.bytes ?? 0,
      progress: null, leaseId: null, leaseUntil: null, attempts: 0, worker: null,
      createdAt: new Date(now), startedAt: null, finishedAt: null, expiresAt: null, error: null, ms: null,
    });
  } catch (err) {
    if (pic) await store.remove(pic.key);
    throw err;
  }
  return id;
}

/** What an app sees of its job (contract v1). The picture's url is made from the app's own request (publicOrigin). */
function clientJob(j, origin, now) {
  const expired = j.status === "done" && j.expiresAt && new Date(j.expiresAt).getTime() <= now;
  return {
    job_id: j._id,
    type: j.type,
    status: j.status,
    ...(j.status === "running" ? { progress: j.progress ?? 0 } : j.status === "done" ? { progress: 1 } : {}),
    ...(j.status === "done" && !expired && j.type !== "image" && j.result ? { result: j.result } : {}),
    ...(j.status === "done" && !expired && j.type === "image" && j.file ? { url: `${origin}${DESK_BASE}/files/${j._id}` } : {}),
    ...(j.status === "failed" ? { error: j.error || "failed" } : {}),
    created_at: isoOf(j.createdAt),
    ...(j.startedAt ? { started_at: isoOf(j.startedAt) } : {}),
    ...(j.finishedAt ? { finished_at: isoOf(j.finishedAt) } : {}),
    ...(j.status === "done" && j.expiresAt ? { expires_at: isoOf(j.expiresAt) } : {}),
    ...(expired ? { expired: true } : {}),
  };
}

/** Leases that ran out: back to pending once, then failed "worker_lost" (input and picture dropped). */
async function requeueLapsed(d, store, now) {
  const jobs = jobsOf(d);
  const lapsed = await jobs.find({ status: "running", leaseUntil: { $lt: new Date(now) } }).toArray();
  for (const j of lapsed) {
    const mine = { _id: j._id, status: "running", leaseId: j.leaseId, leaseUntil: { $lt: new Date(now) } };
    if ((j.attempts ?? 0) < ATTEMPTS_MAX) {
      await jobs.updateOne(mine, { $set: { status: "pending", leaseId: null, leaseUntil: null, worker: null, progress: null, startedAt: null } });
      continue;
    }
    const r = await jobs.updateOne(mine, {
      $set: { status: "failed", error: "worker_lost", finishedAt: new Date(now), leaseId: null, leaseUntil: null, input: null, picture: null, bytes: 0 },
    });
    if (r.matchedCount && j.picture) await store.remove(j.picture.key);
  }
}

let lastSweep = 0;
/** 48 h after done: the result goes (picture deleted, text / maps cleared). 7 days after finished: the record goes. */
export async function sweepDesk(d, store, now = clock()) {
  const jobs = jobsOf(d);
  const old = await jobs.find({ status: "done", expiresAt: { $lte: new Date(now) }, sweptAt: null }).toArray();
  for (const j of old) {
    if (j.file) await store.remove(j.file.key);
    await jobs.updateOne({ _id: j._id, status: "done" }, { $set: { result: null, file: null, bytes: 0, sweptAt: new Date(now) } });
  }
  const gone = await jobs.deleteMany({ status: { $in: ["done", "failed"] }, finishedAt: { $lt: new Date(now - JOB_KEEP_MS) }, bytes: { $lte: 0 } });
  return { results: old.length, jobs: gone?.deletedCount ?? 0 };
}
async function maybeSweep(d, store, now) {
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  try {
    await sweepDesk(d, store, now);
  } catch (err) {
    console.error("[30da hub desk] sweep:", err instanceof Error ? err.message : err);
  }
}

/** PNG, JPEG or WebP, by its first bytes. */
function looksLike(type, buf) {
  if (type === "image/png") return buf.length > 8 && buf.toString("latin1", 1, 4) === "PNG";
  if (type === "image/jpeg") return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (type === "image/webp") return buf.length >= 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP";
  return false;
}

// ---------------------------------------------------------------- the routes

/** POST /jobs (an app). */
async function postJob(ctx) {
  const { d, req, store, now } = ctx;
  const app = await authedApp(d, req);
  const body = await readJson(req, DESK_LIMITS.jobBody, "That job");
  const type = body.type;
  if (!DESK_TYPES.includes(type)) throw invalid("type", `type: ${DESK_TYPES.join(", ")}.`);
  const checked = checkInput(type, body.input);
  const picture = checked.picture ? await normalizeWanImage(checked.picture) : null;
  await gate(d, { type, app, now, extraBytes: picture?.length ?? 0 });
  const id = await queueJob(d, store, { type, input: checked.input, picture, app, source: "client", now });
  return [202, { job_id: id, type, status: "pending" }];
}

async function appJob(d, app, id) {
  const j = JOB_ID_RE.test(id) ? await jobsOf(d).findOne({ _id: id }) : null;
  if (!j || j.source !== "client" || j.app !== app) throw notFound(); // another app's job is no job
  return j;
}

/** GET /jobs/{id} (the app that made it). */
async function getJob(ctx, id) {
  const { d, req, store, now } = ctx;
  const app = await authedApp(d, req);
  await requeueLapsed(d, store, now);
  return [200, clientJob(await appJob(d, app, id), publicOrigin(req), now)];
}

/** GET /files/{id} (the app that made it): the picture. */
async function getFile(ctx, id) {
  const { d, req, res, store, now } = ctx;
  const app = await authedApp(d, req);
  const j = await appJob(d, app, id);
  if (j.type !== "image" || j.status !== "done") throw notFound("This job has no picture (yet).");
  const buf = j.file && new Date(j.expiresAt).getTime() > now ? await store.get(j.file.key) : null;
  if (!buf) throw fail(410, "expired", "The picture was deleted 48 hours after it was made.");
  sendClip(req, res, buf, j.file.type, { "Content-Disposition": `inline; filename="${j._id}.${PICTURE_TYPES[j.file.type]}"` });
  ctx.sent = true;
}

/** POST /worker/claim: a heartbeat, then the oldest pending job of a type it can do and the tower has on, or 204. */
async function claim(ctx) {
  const { d, req, store, now } = ctx;
  await authedWorker(d, req);
  const body = await readJson(req, DESK_LIMITS.json);
  const worker = workerName(body.worker);
  const can = workerTypes(body.types);
  await noteHeartbeat(d, now, worker, { windows: workerWindows(body.windows), types: can, info: workerInfo(body.info) });
  await requeueLapsed(d, store, now);
  const options = await deskOptions(d);
  const types = can.filter((t) => options.types[t]);
  if (!types.length) return [204, null];
  for (let i = 0; i < DESK_LIMITS.queue; i += 1) {
    const leaseId = crypto.randomBytes(16).toString("hex");
    const j = await jobsOf(d).findOneAndUpdate(
      { status: "pending", type: { $in: types } },
      { $set: { status: "running", leaseId, worker, startedAt: new Date(now), progress: 0 }, $inc: { attempts: 1 } },
      { sort: { createdAt: 1 }, returnDocument: "after" },
    );
    if (!j) return [204, null];
    await jobsOf(d).updateOne({ _id: j._id, leaseId }, { $set: { leaseUntil: new Date(now + LEASE_MS[j.type]) } });
    const input = { ...(j.input ?? {}) };
    if (j.picture) {
      let pic;
      try {
        pic = await store.get(j.picture.key);
      } catch (err) {
        await jobsOf(d).updateOne({ _id: j._id, leaseId }, {
          $set: { status: "pending", leaseId: null, leaseUntil: null, worker: null, progress: null, startedAt: null }, $inc: { attempts: -1 },
        });
        throw err;
      }
      if (!pic) {
        await jobsOf(d).updateOne({ _id: j._id, leaseId }, {
          $set: { status: "failed", error: "input_lost", finishedAt: new Date(now), leaseId: null, leaseUntil: null, input: null, picture: null, bytes: 0 },
        });
        continue;
      }
      input.image = pic.toString("base64");
    }
    return [200, { job: { job_id: j._id, lease_id: leaseId, type: j.type, input } }];
  }
  return [204, null];
}

async function leasedJob(d, req, id) {
  const j = JOB_ID_RE.test(id) ? await jobsOf(d).findOne({ _id: id }) : null;
  if (!j) throw notFound();
  const lease = String(req.headers["x-desk-lease"] ?? "");
  if (j.status !== "running" || !j.leaseId || lease !== j.leaseId) throw notYours();
  return j;
}

/** POST /worker/jobs/{id}/progress. */
async function progress(ctx, id) {
  const { d, req, now } = ctx;
  await authedWorker(d, req);
  const j = await leasedJob(d, req, id);
  await noteHeartbeat(d, now, j.worker ?? "worker");
  const body = await readJson(req, DESK_LIMITS.json);
  const p = body.progress;
  if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) throw invalid("progress", "progress: a number from 0 to 1.");
  const leaseUntil = new Date(now + LEASE_MS[j.type]);
  const r = await jobsOf(d).updateOne({ _id: j._id, status: "running", leaseId: j.leaseId }, { $set: { progress: p, leaseUntil } });
  if (!r.matchedCount) throw notYours();
  return [200, { ok: true, job_id: j._id, progress: p, lease_until: leaseUntil.toISOString() }];
}

/** The worker's text / maps answer, checked and trimmed → the result the job keeps. */
function checkResult(type, body) {
  if (type === "text") {
    if (typeof body.text !== "string" || !body.text.trim()) throw invalid("text", "text: the answer.");
    return { text: body.text.trim().slice(0, DESK_LIMITS.resultText) };
  }
  if (!Array.isArray(body.places)) throw invalid("places", "places: a list (it may be empty).");
  if (body.places.length > DESK_LIMITS.places) throw invalid("places", `places: at most ${DESK_LIMITS.places}.`);
  if (body.places.some((p) => !p || typeof p !== "object" || Array.isArray(p))) throw invalid("places", "places: objects.");
  const result = { places: body.places };
  if (Buffer.byteLength(JSON.stringify(result)) > DESK_LIMITS.resultMaps) throw tooLarge("places: at most 48 KB in all.", "places");
  return result;
}

/** POST /worker/jobs/{id}/done: JSON for text / maps, the raw picture for image. */
async function done(ctx, id) {
  const { d, req, store, now } = ctx;
  await authedWorker(d, req);
  const j = await leasedJob(d, req, id);
  await noteHeartbeat(d, now, j.worker ?? "worker");
  const mine = { _id: j._id, status: "running", leaseId: j.leaseId };
  const ms = j.startedAt ? now - new Date(j.startedAt).getTime() : null;
  const finishedSet = { status: "done", progress: 1, finishedAt: new Date(now), leaseId: null, leaseUntil: null, expiresAt: new Date(now + KEEP_MS), sweptAt: null, ms };
  if (j.type !== "image") {
    const result = checkResult(j.type, await readJson(req, DESK_LIMITS.json, "That answer"));
    // The input goes with the answer: nothing an app sent is kept longer than it is needed.
    const x = await jobsOf(d).updateOne(mine, { $set: { ...finishedSet, result, input: null } });
    if (!x.matchedCount) throw notYours();
    return [200, { ok: true, job_id: j._id, status: "done" }];
  }
  const type = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (!PICTURE_TYPES[type]) throw invalid("content_type", "Send the picture as Content-Type image/png, image/jpeg or image/webp.");
  const r = await readRaw(req, DESK_LIMITS.image);
  if (r.tooLarge) throw tooLarge("The picture is over 8 MB.", "picture");
  if (r.bad) throw invalid("picture", "The picture could not be read.");
  if (!looksLike(type, r.buf)) throw invalid("picture", `That is not a ${PICTURE_TYPES[type].toUpperCase()} picture.`);
  const dropInput = { input: null, picture: null };
  const others = (await storedBytes(d)) - (j.bytes ?? 0);
  if (others + r.buf.length > DESK_LIMITS.storage) {
    const x = await jobsOf(d).updateOne(mine, { $set: { status: "failed", error: "storage_full", finishedAt: new Date(now), leaseId: null, leaseUntil: null, ...dropInput, bytes: 0, ms } });
    if (!x.matchedCount) throw notYours();
    if (j.picture) await store.remove(j.picture.key);
    return [200, { ok: true, job_id: j._id, status: "failed", error: "storage_full" }];
  }
  const kept = { key: outKey(j._id, j.leaseId, PICTURE_TYPES[type]), bytes: r.buf.length, type };
  let x;
  try {
    await store.put(kept.key, r.buf);
    x = await jobsOf(d).updateOne(mine, { $set: { ...finishedSet, ...dropInput, file: kept, bytes: kept.bytes } });
  } catch (err) {
    const after = await jobsOf(d).findOne({ _id: j._id }).catch(() => null);
    if (after?.file?.key !== kept.key) {
      await store.remove(kept.key);
      throw err;
    }
    x = { matchedCount: 1 };
  }
  if (!x.matchedCount) {
    await store.remove(kept.key);
    throw notYours();
  }
  if (j.picture) await store.remove(j.picture.key);
  return [200, { ok: true, job_id: j._id, status: "done" }];
}

/** POST /worker/jobs/{id}/fail: { error } — final. */
async function failJob(ctx, id) {
  const { d, req, store, now } = ctx;
  await authedWorker(d, req);
  const j = await leasedJob(d, req, id);
  await noteHeartbeat(d, now, j.worker ?? "worker");
  const body = await readJson(req, DESK_LIMITS.json);
  if (typeof body.error !== "string" || !body.error.trim()) throw invalid("error", "error: a short text.");
  const ms = j.startedAt ? now - new Date(j.startedAt).getTime() : null;
  const x = await jobsOf(d).updateOne({ _id: j._id, status: "running", leaseId: j.leaseId }, {
    $set: { status: "failed", error: oneLine(body.error, DESK_LIMITS.error), finishedAt: new Date(now), leaseId: null, leaseUntil: null, input: null, picture: null, bytes: 0, ms },
  });
  if (!x.matchedCount) throw notYours();
  if (j.picture) await store.remove(j.picture.key);
  return [200, { ok: true, job_id: j._id, status: "failed" }];
}

const ROUTES = [
  ["POST", /^\/jobs$/, postJob],
  ["GET", /^\/jobs\/([^/]+)$/, getJob],
  ["GET", /^\/files\/([^/]+)$/, getFile],
  ["POST", /^\/worker\/claim$/, claim],
  ["POST", /^\/worker\/jobs\/([^/]+)\/progress$/, progress],
  ["POST", /^\/worker\/jobs\/([^/]+)\/done$/, done],
  ["POST", /^\/worker\/jobs\/([^/]+)\/fail$/, failJob],
];

/** /30da/hub/desk/… (src/lib/thirtyda-hub-wan.mjs handleThirtyDaHub sends it here). Errors answer like tower 11's. */
export async function handleDesk(req, res, path) {
  const ctx = { req, res, sent: false };
  try {
    const sub = path.slice(DESK_BASE.length) || "/";
    let hit = null;
    for (const [method, re, fn] of ROUTES) {
      const m = re.exec(sub);
      if (!m) continue;
      if (method !== req.method) {
        hit ??= "method";
        continue;
      }
      hit = [fn, m[1]];
      break;
    }
    if (!hit) throw fail(404, "not_found", "No such endpoint.");
    if (hit === "method") throw fail(405, "method_not_allowed", "Not with this method.");
    ctx.d = await db();
    ctx.store = deskStore();
    ctx.now = clock();
    await maybeSweep(ctx.d, ctx.store, ctx.now);
    const [status, body] = (await hit[0](ctx, hit[1])) ?? [];
    if (ctx.sent) return;
    if (body == null) {
      res.writeHead(status, BASE_HEADERS);
      res.end();
      return;
    }
    sendJson(res, status, body);
  } catch (err) {
    if (res.headersSent) return;
    const tooBig = err instanceof HubError && err.code === "too_large";
    const close = tooBig ? { Connection: "close" } : {};
    if (!tooBig) req.resume();
    if (err instanceof HubError) {
      sendJson(res, err.status, { error: err.code, message: err.message, ...err.extra }, { ...err.headers, ...close });
      return;
    }
    console.error("[30da hub desk]", req.method, path, err instanceof Error ? err.message : err);
    sendJson(res, 500, { error: "server_error", message: "Something went wrong. Try again." }, close);
  }
}

// ---------------------------------------------------------------- the admin's tower (src/lib/thirtyda-admin.mjs)

/** not_set (no worker token, or no app token) · off (every type off) · waiting (for the M1) · live (seen ≤ 2 min ago). */
export function deskStatus({ appsSet, workerSet, anyOn, seenAt, now }) {
  if (!appsSet || !workerSet) return "not_set";
  if (!anyOn) return "off";
  return seenAt && now - new Date(seenAt).getTime() <= LIVE_MS ? "live" : "waiting";
}

/** What a Try's answer looks like on the tower: the text (cut), the first places' names, or the picture's admin URL. */
function tryAnswer(j) {
  if (j.status !== "done" || j.sweptAt) return null;
  if (j.type === "text") return { text: String(j.result?.text ?? "").slice(0, 1200) };
  if (j.type === "maps") {
    const places = Array.isArray(j.result?.places) ? j.result.places : [];
    return { count: places.length, names: places.slice(0, 5).map((p) => oneLine(p?.name ?? p?.title ?? "?", 80)) };
  }
  return j.file ? { url: `${ADMIN_FILES}/${j._id}` } : null;
}

/** A job as the tower lists it: type, app, times, outcome. Never a text prompt; a maps query only, cut short. */
function adminJob(j) {
  return {
    id: j._id,
    type: j.type,
    app: j.app,
    source: j.source,
    status: j.status,
    progress: j.status === "running" ? j.progress ?? 0 : null,
    attempts: j.attempts ?? 0,
    createdAt: isoOf(j.createdAt),
    finishedAt: isoOf(j.finishedAt),
    ms: j.ms ?? null,
    error: j.status === "failed" ? j.error || "failed" : null,
    swept: Boolean(j.sweptAt),
    ...(j.source === "try" ? { answer: tryAnswer(j) } : {}),
  };
}

/** The Code page's `desk` block. Never a token, a hash, a text prompt or a picture. */
export async function deskAdminView(d, req) {
  const now = clock();
  const store = deskStore();
  await maybeSweep(d, store, now);
  try {
    await requeueLapsed(d, store, now);
  } catch (err) {
    console.error("[30da hub desk] requeue:", err instanceof Error ? err.message : err);
  }
  const apps = Object.fromEntries(await Promise.all(Object.entries(DESK_APPS).map(async ([a, x]) => [a, { name: x.name, ...(await tokenStatus(d, x.setting)) }])));
  const [worker, seen, options] = await Promise.all([tokenStatus(d, DESK_WORKER), settingsOf(d).findOne({ _id: SEEN_ID }), deskOptions(d)]);
  const jobs = jobsOf(d);
  const [pending, running, recent, stored, tries] = await Promise.all([
    jobs.countDocuments({ status: "pending" }),
    jobs.countDocuments({ status: "running" }),
    jobs.find({}).sort({ createdAt: -1 }).limit(10).toArray(),
    storedBytes(d),
    Promise.all(DESK_TYPES.map((t) => jobs.findOne({ source: "try", type: t }, { sort: { createdAt: -1 } }))),
  ]);
  const seenAt = seen?.at ? new Date(seen.at) : null;
  return {
    status: deskStatus({ appsSet: Object.values(apps).some((a) => a.set), workerSet: worker.set, anyOn: DESK_TYPES.some((t) => options.types[t]), seenAt, now }),
    endpoint: `${publicOrigin(req)}${DESK_BASE}`,
    contract: "v1",
    worker: seenAt ? {
      seenAt: seenAt.toISOString(),
      seenAgoS: Math.max(0, Math.round((now - seenAt.getTime()) / 1000)),
      name: seen.worker ?? null,
      windows: workerWindows(seen.windows),
      types: Array.isArray(seen.types) ? seen.types.filter((t) => DESK_TYPES.includes(t)) : [],
      info: workerInfo(seen.info),
    } : null,
    queue: { pending, running, max: DESK_LIMITS.queue, storedBytes: stored, storageMax: DESK_LIMITS.storage },
    tokens: { apps, worker },
    options: { ...options, all: DESK_TYPES },
    limits: { perHour: DESK_LIMITS.perHour, keepHours: KEEP_MS / 3600e3, jobDays: JOB_KEEP_MS / 864e5 },
    jobs: recent.map(adminJob),
    tries: Object.fromEntries(DESK_TYPES.map((t, i) => [t, tries[i] ? adminJob(tries[i]) : null])),
  };
}

/** "New token" for an app ('media' | 'm1' | 'm2') or the worker ('worker'): the old one stops at once. → { token, view } */
export async function newDeskToken(d, who, { by = "superadmin" } = {}) {
  const setting = who === "worker" ? DESK_WORKER : DESK_APPS[who]?.setting;
  if (!setting) throw new Error(`No such token: ${String(who).slice(0, 20)}`);
  return makeToken(d, setting, { by });
}

/** "Revoke" → { removed }. */
export async function revokeDeskToken(d, who) {
  const setting = who === "worker" ? DESK_WORKER : DESK_APPS[who]?.setting;
  if (!setting) throw new Error(`No such token: ${String(who).slice(0, 20)}`);
  return removeToken(d, setting);
}

/** The admin's Try of one type: a fixed, harmless job (DESK_TRIES), source 'try', the same caps but the hourly one. */
export async function queueDeskTry(d, type) {
  const now = clock();
  try {
    if (!DESK_TYPES.includes(type)) throw invalid("type", `type: ${DESK_TYPES.join(", ")}.`);
    await gate(d, { type, app: "try", now });
    const { input } = checkInput(type, DESK_TRIES[type]);
    return { ok: true, job_id: await queueJob(d, deskStore(), { type, input, picture: null, app: "try", source: "try", now }) };
  } catch (err) {
    if (err instanceof HubError) return { ok: false, status: err.status, reason: err.code, error: err.message };
    throw err;
  }
}

/** A Try's picture for the tower: { buf, type } or null. An app's pictures never. */
export async function deskTryFile(d, id) {
  const j = JOB_ID_RE.test(String(id)) ? await jobsOf(d).findOne({ _id: id }) : null;
  if (!j || j.source !== "try" || j.type !== "image" || j.status !== "done" || !j.file || j.sweptAt) return null;
  const buf = await deskStore().get(j.file.key);
  return buf ? { buf, type: j.file.type } : null;
}
