/**
 * GK API Hub · tower 11 "Wan" (owner 2026-10-14: "11th Wan its internal M5 installed LLM going to connect with Yai media
 * director to make videos via our API Hub"): image to video with Wan 2.2 TI2V-5B, running in ComfyUI on the owner's M5
 * laptop. Yai Media Director (an app on the M1) sends a picture + a prompt and gets a clip back.
 *
 * Pull design: this server (Railway) never calls the M5. The M5 sleeps and changes network, so its worker calls OUT —
 * claim / progress / done / fail — and jobs simply wait here in the meantime. No tunnel, no open ComfyUI port.
 *
 * Contract v1 (2026-10-14; already with the Yai and M5 teams — change it only together with them). Base /30da/hub/wan
 * (https://ecom.ggmt.sg/30da/hub/wan), JSON unless noted, every call `Authorization: Bearer <token>`.
 * Errors are { error: <code>, message, field? } like the 30+DA app's.
 *   Client (Yai Media Director, the CLIENT token "wanc_…"):
 *   POST /render  { image: base64 JPEG|PNG|WebP ≤ 10 MB decoded, prompt ≤ 1000 chars, negative_prompt? ≤ 1000,
 *                   seconds? 1–10 (5; a fraction like 2.5 is fine), size? "480p" (default) | "720p",
 *                   aspect? "9:16" (default) | "16:9" | "1:1", seed? integer (a negative one, like -1, = random) }
 *        → 202 { job_id, status: "pending" }
 *        400 invalid {field} · 401 unauthorized · 413 too_large · 422 size_off (a size the tower has off)
 *        · 429 queue_full | storage_full | rate_limited (also: more than 3 renders uploading at once) · 503 tower_off
 *   GET  /render/{job_id} → 200 { job_id, status: "pending"|"running"|"done"|"failed", progress? 0–1, url? (done: the
 *        absolute clip URL, on the host this GET was sent to — never one a worker's request named), error? (failed: a
 *        short code), created_at, started_at?, finished_at?, expires_at? (done) } · 404 not_found
 *   GET  /clips/{job_id}  (the same client token) → 200 the clip, Content-Type video/mp4 or image/webp (byte ranges work).
 *        Kept 48 h after done, then deleted (download it) · 404 not_found (no such job, or not done) · 410 expired
 *   Worker (the M5, the WORKER token "wanw_…"):
 *   POST /worker/claim  { worker: "M5", info?: { gpu?, comfy_version? } }
 *        → 200 { job: { job_id, lease_id, image (base64 JPEG ≤ 1280 px long side), prompt, negative_prompt, seconds, size,
 *        aspect, seed } } · 204 nothing to do. Every claim is a heartbeat (call it every ~20 s while idle); a claim leases
 *        the job for 45 min. (A 500 means the picture could not be read just now: the job is back in the queue, ask again.)
 *   With header X-Wan-Lease: <lease_id> from the claim (else 409 not_yours: the lease ran out and the job moved on):
 *   POST /worker/jobs/{job_id}/progress  { progress: 0–1 } → 200 (the lease runs 45 min from now again)
 *   POST /worker/jobs/{job_id}/done      raw body = the clip, Content-Type video/mp4 or image/webp, ≤ 40 MB → 200
 *   POST /worker/jobs/{job_id}/fail      { error: "short text" } → 200
 *   Progress, done and fail are heartbeats too (a busy worker does not claim): the tower stays Live while it renders.
 *   A lease that runs out puts the job back once; the second time it fails with "worker_lost".
 *   Every refusal is answered on a connection that stays open (the body is read to its end and dropped), so the status
 *   gets through even while the client is still sending; only a 413 too_large closes the connection without reading the
 *   rest, so a client may see that one as a reset (an upload over the limit is a bug on its side).
 *
 * Tokens (src/lib/thirtyda-settings.mjs TOKEN_SETTINGS): made on the admin Code page, tower 11; only their SHA-256, last 4
 * and made-at are kept, the token is shown once. A client token on a worker route (or the other way round) is a 401.
 *
 * Kept: jobs in `thirtyda_hub_wan_jobs`; the bytes (the input picture, the clip) in a small store like the 30+DA photos
 * (src/lib/thirtyda-photos.mjs): GridFS bucket `thirtyda_hub_wan` when THIRTYDA_PHOTO_STORE=mongo (the live server), else
 * files in <repo>/.data/hub-wan/ (gitignored). The input is re-encoded with sharp (JPEG ≤ 1280 px, EXIF dropped) and
 * deleted once the job is done or failed; a clip is deleted 48 h after done (a sweep, at most once a minute, run by
 * requests). Job records go 30 days after they finished.
 * Guards for the Mongo M0 (512 MB, filled twice): ≤ 10 jobs pending + running (429 queue_full), ≤ 150 MB of inputs +
 * clips kept (429 storage_full; a clip that would pass it fails its job "storage_full"), ≤ 30 renders per client token
 * per hour (429 rate_limited), ≤ 3 renders being uploaded / decoded at once (429 rate_limited, before the body is read:
 * the caps only count jobs already in the database). The caps are checked, then written: two renders at the very same
 * moment may pass one over. A failed upload deletes what it wrote (no chunks left uncounted), and every upload has a
 * key of its own (a retry or a duplicate /done never writes over, or deletes, another one's clip).
 *
 * Tower options (thirtyda_settings `wan_options`): on/off (on by default once a client token exists), the sizes allowed
 * (480p on; 720p OFF by default — the M5's 32 GB runs out of memory at 720p), the most seconds (10). The worker's last
 * call (`wan_worker_seen`: when, its name, the info its last claim gave) — a claim, or a progress / done / fail while it
 * renders — makes the tower Live for 2 minutes.
 *
 * The admin side (src/lib/thirtyda-admin.mjs, Code page tower 11) uses wanAdminView, newWanToken, revokeWanToken,
 * saveWanOptions, queueWanTry and wanTryClip: "Try" queues a render of src/thirtyda-app/home/img/people-1.jpg (source
 * "try", the same caps) that only the admin can play back.
 *
 * Mounted by src/scripts/serve-web.mjs on its own branch ahead of the 30+DA app: the app's PIN / verify / terms guards
 * never see these routes. Server to server: no cookies, no CORS.
 */

import crypto from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { finished } from "node:stream/promises";
import sharp from "sharp";
import { GridFSBucket } from "mongodb";
import { getDb } from "./mongo.ts";
import { SETTINGS_COLLECTION, checkToken, tokenStatus, makeToken, removeToken } from "./thirtyda-settings.mjs";
import { publicOrigin } from "./thirtyda-signin.mjs";

export const HUB_BASE = "/30da/hub";
export const WAN_BASE = `${HUB_BASE}/wan`;
export const WAN_JOBS = "thirtyda_hub_wan_jobs";
export const WAN_BUCKET = "thirtyda_hub_wan";
const OPTIONS_ID = "wan_options";
const SEEN_ID = "wan_worker_seen";
/** kind → the token's setting (src/lib/thirtyda-settings.mjs TOKEN_SETTINGS). */
export const WAN_TOKENS = { client: "wan_client", worker: "wan_worker" };

const MB = 1024 * 1024;
export const WAN_LIMITS = Object.freeze({
  renderBody: 14 * MB, // POST /render: the JSON with the base64 picture
  image: 10 * MB, // the picture, decoded
  clip: 40 * MB, // POST …/done
  json: 16 * 1024, // every other JSON body
  prompt: 1000,
  error: 200, // a worker's fail text, cut to this
  queue: 10, // pending + running
  storage: 150 * MB, // inputs + clips kept
  perHour: 30, // renders per client per hour
  inputPx: 1280,
});
export const WAN_SIZES = ["480p", "720p"];
export const WAN_ASPECTS = ["9:16", "16:9", "1:1"];
const SECONDS_MIN = 1;
export const SECONDS_MAX = 10;
const SECONDS_DEFAULT = 5;
const DEFAULT_SIZES = { "480p": true, "720p": false };
const CLIP_TYPES = { "video/mp4": "mp4", "image/webp": "webp" };
export const LEASE_MS = 45 * 60e3;
const ATTEMPTS_MAX = 2; // a lease that runs out puts the job back once
export const CLIP_KEEP_MS = 48 * 3600e3;
const JOB_KEEP_MS = 30 * 24 * 3600e3;
export const LIVE_MS = 2 * 60e3;
const SWEEP_EVERY_MS = 60e3;
const HOUR_MS = 3600e3;
const JOB_ID_RE = /^[a-f0-9]{32}$/;
const TRY_IMAGE = new URL("../thirtyda-app/home/img/people-1.jpg", import.meta.url);
const TRY_PROMPT = "The person smiles and turns slightly toward the camera, soft daylight, gentle hair movement.";
const ADMIN_CLIPS = "/30da/admin/api/connections/wan/clips";

// ---------------------------------------------------------------- the byte store (input pictures, clips)

// <job id>.in.jpg · <job id>-<lease>-<random>.clip.mp4|webp (the lease and a random part of each upload's own in the name:
// a late worker's upload, a retry or a duplicate /done never writes over, or deletes, another one's clip)
const KEY_RE = /^[a-f0-9]{32}(?:\.in\.jpg|-[a-f0-9]{8}-[a-f0-9]{8}\.clip\.(?:mp4|webp))$/;
const keyOk = (key) => typeof key === "string" && KEY_RE.test(key);

/** In memory: the unit tests. */
export function memoryStore() {
  const files = new Map();
  return {
    kind: "memory",
    files,
    async put(key, buf) { if (!keyOk(key)) throw new Error("bad key"); files.set(key, Buffer.from(buf)); },
    async get(key) { return keyOk(key) && files.has(key) ? Buffer.from(files.get(key)) : null; },
    async remove(key) { files.delete(key); },
  };
}

/** Files in a folder (dev): <repo>/.data/hub-wan/ by default, gitignored like .data/30da-photos. */
export function fileStore(dir = new URL("../../.data/hub-wan/", import.meta.url)) {
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
        if (err?.code === "ENOENT") return null; // gone; any other failure is thrown, not taken for "gone"
        throw err;
      }
    },
    async remove(key) {
      if (!keyOk(key)) return;
      try { await unlink(new URL(key, dir)); } catch { /* already gone */ }
    },
  };
}

/** GridFS bucket `thirtyda_hub_wan` (the live server, THIRTYDA_PHOTO_STORE=mongo). The key is the file's id. */
export function gridStore(dbFn = getDb) {
  let bucket = null;
  const grid = async () => (bucket ??= new GridFSBucket(await dbFn(), { bucketName: WAN_BUCKET }));
  return {
    kind: "mongo",
    async put(key, buf) {
      if (!keyOk(key)) throw new Error("bad key");
      const b = await grid();
      const up = b.openUploadStreamWithId(key, key);
      up.on("error", () => {}); // seen by once() / finished() below
      try {
        // One chunk at a time (the stream runs one write after the other): when an insert fails, none is still in flight.
        for (let at = 0; at < buf.length; at += up.chunkSizeBytes) {
          if (!up.write(buf.subarray(at, at + up.chunkSizeBytes))) await once(up, "drain");
        }
        up.end();
        await finished(up);
      } catch (err) {
        // A failed upload leaves the chunks it wrote (and no files doc): nothing would count or sweep them. The driver's
        // delete removes chunks even without a files doc (then it throws "File not found", ignored).
        await b.delete(key).catch(() => {});
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
        // Gone (no such file, or its chunks broken) → null. A read that failed (network, timeout) is thrown, never
        // taken for "gone": a claim would fail an intact job "input_lost".
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

// Unit tests only (src/lib/thirtyda-hub-wan.test.mjs): an in-memory database, an in-memory store and a clock. Unset in
// the server, where the hub uses getDb(), the store THIRTYDA_PHOTO_STORE picks and the real time.
const testHooks = { db: null, store: null, now: null };
export function setHubWanTestHooks({ db: d = null, store = null, now = null } = {}) {
  testHooks.db = d;
  testHooks.store = store;
  testHooks.now = now;
  lastSweep = 0;
}
const clock = () => (testHooks.now ? testHooks.now() : Date.now());

let defaultStore = null;
function hubStore() {
  if (testHooks.store) return testHooks.store;
  return (defaultStore ??= process.env.THIRTYDA_PHOTO_STORE === "mongo" ? gridStore() : fileStore());
}

// ---------------------------------------------------------------- db

let ready = null;
async function db() {
  if (testHooks.db) return testHooks.db;
  const d = await getDb();
  if (!ready) {
    const jobs = d.collection(WAN_JOBS);
    ready = Promise.all([
      jobs.createIndex({ status: 1, createdAt: 1 }),
      jobs.createIndex({ client: 1, createdAt: 1 }),
    ]).catch((e) => { ready = null; throw e; });
  }
  await ready;
  return d;
}
const jobsOf = (d) => d.collection(WAN_JOBS);
const settingsOf = (d) => d.collection(SETTINGS_COLLECTION);

// ---------------------------------------------------------------- http

export class HubError extends Error {
  constructor(status, code, message, extra = {}, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
    this.headers = headers;
  }
}
// Shared with Tower 14 · Agent Desk (src/lib/thirtyda-hub-desk.mjs): the same errors, bodies and answers.
export const fail = (status, code, message, extra, headers) => new HubError(status, code, message, extra, headers);
export const invalid = (field, message) => fail(400, "invalid", message, { field });
export const tooLarge = (message, field) => fail(413, "too_large", message, field ? { field } : {});
export const notFound = (message = "No such job.") => fail(404, "not_found", message);
const notYours = () => fail(409, "not_yours", "This job is no longer leased to you: the lease ran out and the job moved on.");

export const BASE_HEADERS = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" };

export function sendJson(res, status, obj, headers = {}) {
  res.writeHead(status, { ...BASE_HEADERS, "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(obj));
}

/**
 * The raw body, at most `max` BYTES → { buf } or { tooLarge } / { bad }. A declared Content-Length over `max` is refused
 * before a byte is read; while reading, nothing past `max` is kept and the answer goes out at once (the caller closes
 * the connection, so the rest is never read into memory).
 */
export function readRaw(req, max) {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > max) return Promise.resolve({ tooLarge: true });
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      resolve(r);
    };
    req.on("data", (c) => {
      if (done) return;
      size += c.length;
      if (size > max) {
        chunks.length = 0;
        finish({ tooLarge: true });
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => finish({ buf: Buffer.concat(chunks) }));
    req.on("error", () => finish({ bad: true }));
  });
}

/** A JSON object body of at most `max` bytes, or the matching HubError. */
export async function readJson(req, max = WAN_LIMITS.json, what = "That body") {
  const r = await readRaw(req, max);
  if (r.tooLarge) throw tooLarge(`${what} is too large.`);
  if (r.bad) throw invalid("body", "The body could not be read.");
  const raw = r.buf.toString("utf8");
  if (!raw.trim()) return {};
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  } catch { /* below */ }
  throw invalid("body", "Send a JSON object.");
}

/** "bytes=a-b" | "bytes=a-" | "bytes=-n" → { start, end } (one range); null = send it all; 'bad' = 416. */
function byteRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header ?? "").trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start;
  let end;
  if (!m[1]) {
    const n = Number(m[2]);
    if (!n) return "bad";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  return start > end || start >= size ? "bad" : { start, end };
}

/**
 * A clip's bytes, with byte ranges (a <video> asks for them; Safari plays nothing without). Used here for the client and
 * by the admin's Try player (with its own security headers).
 */
export function sendClip(req, res, buf, type, headers = {}) {
  const base = { ...headers, "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  const r = byteRange(req.headers.range, buf.length);
  if (r === "bad") {
    res.writeHead(416, { ...base, "Content-Range": `bytes */${buf.length}` });
    return res.end();
  }
  if (r) {
    const part = buf.subarray(r.start, r.end + 1);
    res.writeHead(206, { ...base, "Content-Range": `bytes ${r.start}-${r.end}/${buf.length}`, "Content-Length": part.length });
    return res.end(part);
  }
  res.writeHead(200, { ...base, "Content-Length": buf.length });
  return res.end(buf);
}

// ---------------------------------------------------------------- tokens

/** The bearer token of `kind` ('client' | 'worker') → { hash }, or a 401. The other kind's token is a 401 too. */
async function authed(d, req, kind) {
  const m = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(String(req.headers.authorization ?? ""));
  const who = m ? await checkToken(d, WAN_TOKENS[kind], m[1]) : null;
  if (!who) {
    throw fail(401, "unauthorized", `Send the ${kind} token: Authorization: Bearer <token>.`, {}, { "WWW-Authenticate": 'Bearer realm="wan"' });
  }
  return who;
}

// ---------------------------------------------------------------- options + the worker's heartbeat

const isoOf = (t) => (t ? new Date(t).toISOString() : null);

/** The tower's options. clientSet: whether a client token exists (the tower is on by default once one does). */
export async function wanOptions(d, { clientSet }) {
  const doc = await settingsOf(d).findOne({ _id: OPTIONS_ID });
  const sizes = { ...DEFAULT_SIZES };
  for (const s of WAN_SIZES) if (typeof doc?.sizes?.[s] === "boolean") sizes[s] = doc.sizes[s];
  const max = doc?.maxSeconds;
  return {
    enabled: typeof doc?.enabled === "boolean" ? doc.enabled : Boolean(clientSet),
    enabledSaved: typeof doc?.enabled === "boolean",
    sizes,
    maxSeconds: Number.isInteger(max) && max >= SECONDS_MIN && max <= SECONDS_MAX ? max : SECONDS_MAX,
    updatedAt: isoOf(doc?.updatedAt),
  };
}

/**
 * Save the tower's options (admin): { enabled?, sizes?: { '480p'?, '720p'? }, maxSeconds? } — what is left out stays.
 * → { ok:true, options } | { ok:false, field, error } (plain words).
 */
export async function saveWanOptions(d, input, { by = "superadmin" } = {}) {
  const v = input && typeof input === "object" ? input : {};
  const doc = (await settingsOf(d).findOne({ _id: OPTIONS_ID })) ?? {};
  const next = { _id: OPTIONS_ID, kind: "options", sizes: { ...DEFAULT_SIZES, ...(doc.sizes ?? {}) } };
  if (typeof doc.enabled === "boolean") next.enabled = doc.enabled;
  if (Number.isInteger(doc.maxSeconds)) next.maxSeconds = doc.maxSeconds;
  if ("enabled" in v) {
    if (typeof v.enabled !== "boolean") return { ok: false, field: "enabled", error: "On or Off." };
    next.enabled = v.enabled;
  }
  if ("sizes" in v) {
    if (!v.sizes || typeof v.sizes !== "object") return { ok: false, field: "sizes", error: "Pick the sizes." };
    for (const s of WAN_SIZES) {
      if (!(s in v.sizes)) continue;
      if (typeof v.sizes[s] !== "boolean") return { ok: false, field: "sizes", error: `${s}: on or off.` };
      next.sizes[s] = v.sizes[s];
    }
  }
  if (!WAN_SIZES.some((s) => next.sizes[s])) return { ok: false, field: "sizes", error: "Keep at least one size on." };
  if ("maxSeconds" in v) {
    const n = v.maxSeconds;
    if (!Number.isInteger(n) || n < SECONDS_MIN || n > SECONDS_MAX) {
      return { ok: false, field: "maxSeconds", error: `The most seconds is a whole number from ${SECONDS_MIN} to ${SECONDS_MAX}.` };
    }
    next.maxSeconds = n;
  }
  next.updatedAt = new Date(clock());
  next.updatedBy = by;
  await settingsOf(d).replaceOne({ _id: OPTIONS_ID }, next, { upsert: true });
  const clientSet = (await tokenStatus(d, WAN_TOKENS.client)).set;
  return { ok: true, options: await wanOptions(d, { clientSet }) };
}

/** What the worker says about itself, kept short and plain: a name and { gpu, comfy_version }. */
function workerName(v) {
  if (v == null) return "worker";
  if (typeof v !== "string" || !v.trim() || v.trim().length > 40) throw invalid("worker", "worker: a short name, like \"M5\".");
  return v.trim();
}
function workerInfo(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out = {};
  for (const k of ["gpu", "comfy_version"]) {
    if (typeof v[k] === "string" && v[k].trim()) out[k] = v[k].trim().replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 60);
  }
  return out;
}

/**
 * The worker was here now. A claim brings its info; progress / done / fail (a busy worker does not claim: a claim would
 * lease it a second job) only say "still here", and keep the info its last claim gave.
 */
async function noteHeartbeat(d, now, worker, info) {
  const set = { kind: "status", at: new Date(now), worker };
  if (info) set.info = info;
  await settingsOf(d).updateOne({ _id: SEEN_ID }, { $set: set }, { upsert: true });
}

// ---------------------------------------------------------------- jobs

const inputKey = (id) => `${id}.in.jpg`;
const clipKey = (id, leaseId, ext) => `${id}-${String(leaseId).slice(0, 8)}-${crypto.randomBytes(4).toString("hex")}.clip.${ext}`;

/** The bytes kept now (inputs + clips), from the jobs' own counts. */
async function storedBytes(d) {
  const rows = await jobsOf(d).find({ bytes: { $gt: 0 } }, { projection: { bytes: 1 } }).toArray();
  return rows.reduce((n, j) => n + (Number(j.bytes) || 0), 0);
}
const activeCount = (d) => jobsOf(d).countDocuments({ status: { $in: ["pending", "running"] } });
const rendersThisHour = (d, client, now) => jobsOf(d).countDocuments({ client, createdAt: { $gt: new Date(now - HOUR_MS) } });

/**
 * Leases that ran out (on every claim and every client GET): back to pending once, then failed "worker_lost" (its input
 * deleted). Each change is conditional on the very lease it saw AND on that lease still being over (a progress that
 * lands between the read and the write moves leaseUntil on), so a worker that comes back in time keeps its job.
 */
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
      $set: { status: "failed", error: "worker_lost", finishedAt: new Date(now), leaseId: null, leaseUntil: null, input: null, bytes: 0 },
    });
    if (r.matchedCount && j.input) await store.remove(j.input.key);
  }
}

let lastSweep = 0;
/**
 * Clips 48 h after done leave the store (the job keeps its record, without the clip); job records go 30 days after they
 * finished. At most once a minute, from requests (no timer: the hub may run on several instances, or sleep).
 */
export async function sweepWan(d, store, now = clock()) {
  const jobs = jobsOf(d);
  const old = await jobs.find({ status: "done", expiresAt: { $lte: new Date(now) }, clip: { $ne: null } }).toArray();
  for (const j of old) {
    await store.remove(j.clip.key);
    await jobs.updateOne({ _id: j._id, status: "done" }, { $set: { clip: null, bytes: 0, sweptAt: new Date(now) } });
  }
  const gone = await jobs.deleteMany({ status: { $in: ["done", "failed"] }, finishedAt: { $lt: new Date(now - JOB_KEEP_MS) }, bytes: { $lte: 0 } });
  return { clips: old.length, jobs: gone?.deletedCount ?? 0 };
}
async function maybeSweep(d, store, now) {
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  try {
    await sweepWan(d, store, now);
  } catch (err) {
    console.error("[30da hub wan] sweep:", err instanceof Error ? err.message : err);
  }
}

/** Decode, check (JPEG, PNG or WebP), shrink to ≤ 1280 px, re-encode as JPEG. EXIF and every other tag are dropped. */
export async function normalizeWanImage(buf) {
  const bad = () => invalid("image", "image: a JPEG, PNG or WebP picture, base64.");
  let meta;
  try {
    meta = await sharp(buf, { failOn: "error", limitInputPixels: 50e6 }).metadata();
  } catch {
    throw bad();
  }
  if (!["jpeg", "png", "webp"].includes(meta.format)) throw bad();
  try {
    return await sharp(buf, { failOn: "error", limitInputPixels: 50e6 })
      .rotate() // apply the EXIF orientation before the metadata is dropped
      .resize({ width: WAN_LIMITS.inputPx, height: WAN_LIMITS.inputPx, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
  } catch {
    throw bad();
  }
}

/** base64 (or a data: URL) → Buffer, or the matching HubError. */
function decodeImage(v) {
  if (typeof v !== "string" || !v.trim()) throw invalid("image", "image: a JPEG, PNG or WebP picture, base64.");
  const b64 = v.trim().replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "").replace(/\s+/g, "");
  if (!b64 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(b64)) throw invalid("image", "image: not base64.");
  if (Math.floor((b64.length * 3) / 4) > WAN_LIMITS.image + 3) throw tooLarge("image: at most 10 MB.", "image");
  const buf = Buffer.from(b64, "base64");
  if (buf.length > WAN_LIMITS.image) throw tooLarge("image: at most 10 MB.", "image");
  if (!buf.length) throw invalid("image", "image: empty.");
  return buf;
}

const optionalText = (v, field) => {
  if (v == null) return "";
  if (typeof v !== "string") throw invalid(field, `${field}: text.`);
  const t = v.trim();
  if (t.length > WAN_LIMITS.prompt) throw invalid(field, `${field}: at most ${WAN_LIMITS.prompt} characters.`);
  return t;
};

/**
 * A render's fields, checked against the contract and the tower's options → the job's settings. The picture is checked
 * separately (it is the heavy part). Throws 400 invalid {field} / 422 size_off.
 */
function renderFields(v, options) {
  const prompt = optionalText(v.prompt, "prompt");
  if (!prompt) throw invalid("prompt", "prompt: say what should happen in the clip.");
  const negative = optionalText(v.negative_prompt, "negative_prompt");
  // Contract v1 says 1–10, not whole seconds: 2.5 is taken (the M5 turns it into frames).
  const seconds = v.seconds == null ? Math.min(SECONDS_DEFAULT, options.maxSeconds) : v.seconds;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < SECONDS_MIN || seconds > SECONDS_MAX) {
    throw invalid("seconds", `seconds: a number from ${SECONDS_MIN} to ${SECONDS_MAX}.`);
  }
  if (seconds > options.maxSeconds) throw invalid("seconds", `seconds: at most ${options.maxSeconds} on this tower.`);
  const size = v.size == null ? "480p" : v.size;
  if (!WAN_SIZES.includes(size)) throw invalid("size", `size: ${WAN_SIZES.join(" or ")}.`);
  if (!options.sizes[size]) {
    throw fail(422, "size_off", `${size} is off on this tower.`, { field: "size", sizes: WAN_SIZES.filter((s) => options.sizes[s]) });
  }
  const aspect = v.aspect == null ? "9:16" : v.aspect;
  if (!WAN_ASPECTS.includes(aspect)) throw invalid("aspect", `aspect: ${WAN_ASPECTS.join(", ")}.`);
  // Contract v1: "seed?: integer". A negative one (-1: "random" in ComfyUI front-ends) is taken as no seed; the M5
  // never gets a negative seed (ComfyUI's KSampler wants 0 or more).
  let seed = v.seed;
  if (seed != null && !Number.isSafeInteger(seed)) throw invalid("seed", "seed: a whole number (leave it out, or -1, for a random one).");
  if (seed == null || seed < 0) seed = crypto.randomInt(0, 2 ** 32);
  return { prompt, negativePrompt: negative, seconds, size, aspect, seed };
}

/** Refuses a render while the tower is off or a cap is reached (the ones that need no picture). */
async function gate(d, options, client, now) {
  if (!options.enabled) throw fail(503, "tower_off", "The Wan tower is off.");
  if ((await rendersThisHour(d, client, now)) >= WAN_LIMITS.perHour) {
    throw fail(429, "rate_limited", `At most ${WAN_LIMITS.perHour} renders an hour. Try again later.`);
  }
  if ((await activeCount(d)) >= WAN_LIMITS.queue) throw fail(429, "queue_full", `${WAN_LIMITS.queue} renders are already waiting. Try again later.`);
  if ((await storedBytes(d)) >= WAN_LIMITS.storage) throw fail(429, "storage_full", "The hub is full of clips. Try again later.");
}

/** Store the picture and queue the job (the caps checked again, the storage with the picture's real size). → the job id. */
async function queueJob(d, store, { jpeg, fields, source, client, now }) {
  if ((await rendersThisHour(d, client, now)) >= WAN_LIMITS.perHour) {
    throw fail(429, "rate_limited", `At most ${WAN_LIMITS.perHour} renders an hour. Try again later.`);
  }
  if ((await activeCount(d)) >= WAN_LIMITS.queue) throw fail(429, "queue_full", `${WAN_LIMITS.queue} renders are already waiting. Try again later.`);
  if ((await storedBytes(d)) + jpeg.length > WAN_LIMITS.storage) throw fail(429, "storage_full", "The hub is full of clips. Try again later.");
  const id = crypto.randomBytes(16).toString("hex");
  const input = { key: inputKey(id), bytes: jpeg.length };
  try {
    await store.put(input.key, jpeg);
    await jobsOf(d).insertOne({
      _id: id, status: "pending", source, client, ...fields,
      input, clip: null, bytes: input.bytes,
      progress: null, leaseId: null, leaseUntil: null, attempts: 0, worker: null,
      createdAt: new Date(now), startedAt: null, finishedAt: null, expiresAt: null, error: null,
    });
  } catch (err) {
    await store.remove(input.key); // a put that failed half way, or a job that was never written: nothing left behind
    throw err;
  }
  return id;
}

/**
 * What the client sees of a job (contract v1). `origin`: the client's OWN request's (publicOrigin) — the clip's url is made
 * here, at read time, never kept from the worker's /done: a worker token (the M5's config) must not pick the host the
 * client then sends its client token to.
 */
function clientJob(j, origin) {
  return {
    job_id: j._id,
    status: j.status,
    ...(j.status === "running" ? { progress: j.progress ?? 0 } : j.status === "done" ? { progress: 1 } : {}),
    ...(j.status === "done" ? { url: `${origin}${WAN_BASE}/clips/${j._id}` } : {}),
    ...(j.status === "failed" ? { error: j.error || "failed" } : {}),
    created_at: isoOf(j.createdAt),
    ...(j.startedAt ? { started_at: isoOf(j.startedAt) } : {}),
    ...(j.finishedAt ? { finished_at: isoOf(j.finishedAt) } : {}),
    ...(j.status === "done" && j.expiresAt ? { expires_at: isoOf(j.expiresAt) } : {}),
  };
}

/** The start of an MP4 (an ISO BMFF "ftyp" box) or of a WebP ("RIFF" … "WEBP"). */
function looksLike(type, buf) {
  if (type === "video/mp4") return buf.length >= 12 && buf.toString("latin1", 4, 8) === "ftyp";
  if (type === "image/webp") return buf.length >= 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP";
  return false;
}

// ---------------------------------------------------------------- the routes

/**
 * Renders being read / decoded right now (this process). Each holds ~50 MB (the 14 MB body, its string, the picture, sharp's
 * decode) and none is in the database yet, so the caps cannot see them: past RENDERS_AT_ONCE, 429 before the body is read.
 */
export const RENDERS_AT_ONCE = 3;
let rendering = 0;

/** POST /render (client). */
async function render(ctx) {
  const { d, req, store, now } = ctx;
  const who = await authed(d, req, "client");
  const client = who.hash.slice(0, 16); // one client token = one client (its rate); the hash, never the token
  if (rendering >= RENDERS_AT_ONCE) {
    throw fail(429, "rate_limited", `${RENDERS_AT_ONCE} renders are being uploaded right now. Try again in a moment.`);
  }
  rendering += 1;
  try {
    const options = await wanOptions(d, { clientSet: true });
    await gate(d, options, client, now);
    const body = await readJson(req, WAN_LIMITS.renderBody, "That render");
    const fields = renderFields(body, options);
    const jpeg = await normalizeWanImage(decodeImage(body.image));
    const id = await queueJob(d, store, { jpeg, fields, source: "client", client, now });
    return [202, { job_id: id, status: "pending" }];
  } finally {
    rendering -= 1;
  }
}

async function clientJobOf(d, id) {
  const j = JOB_ID_RE.test(id) ? await jobsOf(d).findOne({ _id: id }) : null;
  if (!j || j.source !== "client") throw notFound();
  return j;
}

/** GET /render/{job_id} (client). */
async function renderStatus(ctx, id) {
  const { d, req, store, now } = ctx;
  await authed(d, req, "client");
  await requeueLapsed(d, store, now);
  return [200, clientJob(await clientJobOf(d, id), publicOrigin(req))];
}

/** GET /clips/{job_id} (client): the bytes themselves. */
async function clip(ctx, id) {
  const { d, req, res, store } = ctx;
  await authed(d, req, "client");
  const j = await clientJobOf(d, id);
  if (j.status !== "done") throw notFound("This job has no clip (yet).");
  const buf = j.clip ? await store.get(j.clip.key) : null;
  if (!buf) throw fail(410, "expired", "The clip was deleted 48 hours after it was made.");
  sendClip(req, res, buf, j.clip.type, { "Content-Disposition": `inline; filename="${j._id}.${CLIP_TYPES[j.clip.type]}"` });
  ctx.sent = true;
}

/** POST /worker/claim (worker): a heartbeat, then the oldest pending job leased for 45 min, or 204. */
async function claim(ctx) {
  const { d, req, store, now } = ctx;
  await authed(d, req, "worker");
  const body = await readJson(req);
  const worker = workerName(body.worker);
  await noteHeartbeat(d, now, worker, workerInfo(body.info));
  await requeueLapsed(d, store, now);
  // A job whose picture is gone fails ("input_lost") and the next one is tried. A read that FAILED (network, timeout) is
  // not "gone": that job goes back as it was and this claim is a 500 (the M5 asks again).
  for (let i = 0; i < WAN_LIMITS.queue; i += 1) {
    const leaseId = crypto.randomBytes(16).toString("hex");
    const j = await jobsOf(d).findOneAndUpdate(
      { status: "pending" },
      {
        $set: { status: "running", leaseId, leaseUntil: new Date(now + LEASE_MS), worker, startedAt: new Date(now), progress: 0 },
        $inc: { attempts: 1 },
      },
      { sort: { createdAt: 1 }, returnDocument: "after" },
    );
    if (!j) return [204, null];
    let image;
    try {
      image = j.input ? await store.get(j.input.key) : null;
    } catch (err) {
      await jobsOf(d).updateOne({ _id: j._id, leaseId }, {
        $set: { status: "pending", leaseId: null, leaseUntil: null, worker: null, progress: null, startedAt: null },
        $inc: { attempts: -1 },
      });
      throw err;
    }
    if (!image) {
      await jobsOf(d).updateOne({ _id: j._id, leaseId }, {
        $set: { status: "failed", error: "input_lost", finishedAt: new Date(now), leaseId: null, leaseUntil: null, input: null, bytes: 0 },
      });
      if (j.input) await store.remove(j.input.key); // whatever is left of it (broken chunks) goes too
      continue;
    }
    return [200, {
      job: {
        job_id: j._id, lease_id: leaseId, image: image.toString("base64"),
        prompt: j.prompt, negative_prompt: j.negativePrompt ?? "", seconds: j.seconds, size: j.size, aspect: j.aspect, seed: j.seed,
      },
    }];
  }
  return [204, null];
}

/** The job behind a worker call, still leased to the X-Wan-Lease it sent; 404 / 409 not_yours otherwise. */
async function leasedJob(d, req, id) {
  const j = JOB_ID_RE.test(id) ? await jobsOf(d).findOne({ _id: id }) : null;
  if (!j) throw notFound();
  const lease = String(req.headers["x-wan-lease"] ?? "");
  if (j.status !== "running" || !j.leaseId || lease !== j.leaseId) throw notYours();
  return j;
}

/** POST /worker/jobs/{id}/progress (worker): { progress: 0–1 }; the lease runs 45 min from now again. */
async function progress(ctx, id) {
  const { d, req, now } = ctx;
  await authed(d, req, "worker");
  const j = await leasedJob(d, req, id);
  await noteHeartbeat(d, now, j.worker ?? "worker");
  const body = await readJson(req);
  const p = body.progress;
  if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) throw invalid("progress", "progress: a number from 0 to 1.");
  const leaseUntil = new Date(now + LEASE_MS);
  const r = await jobsOf(d).updateOne({ _id: j._id, status: "running", leaseId: j.leaseId }, { $set: { progress: p, leaseUntil } });
  if (!r.matchedCount) throw notYours();
  return [200, { ok: true, job_id: j._id, progress: p, lease_until: leaseUntil.toISOString() }];
}

/** POST /worker/jobs/{id}/done (worker): the clip as the raw body. */
async function done(ctx, id) {
  const { d, req, store, now } = ctx;
  await authed(d, req, "worker");
  const j = await leasedJob(d, req, id);
  await noteHeartbeat(d, now, j.worker ?? "worker");
  const type = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (!CLIP_TYPES[type]) throw invalid("content_type", "Send the clip as Content-Type video/mp4 or image/webp.");
  const r = await readRaw(req, WAN_LIMITS.clip);
  if (r.tooLarge) throw tooLarge("The clip is over 40 MB.", "clip");
  if (r.bad) throw invalid("clip", "The clip could not be read.");
  if (!looksLike(type, r.buf)) throw invalid("clip", `That is not a ${CLIP_TYPES[type].toUpperCase()} file.`);
  const mine = { _id: j._id, status: "running", leaseId: j.leaseId };
  const finished = { finishedAt: new Date(now), leaseId: null, leaseUntil: null, input: null };
  // The M0 guard: a clip that would take the hub over its storage fails the job rather than fill the database.
  const others = (await storedBytes(d)) - (j.bytes ?? 0);
  if (others + r.buf.length > WAN_LIMITS.storage) {
    const x = await jobsOf(d).updateOne(mine, { $set: { ...finished, status: "failed", error: "storage_full", bytes: 0 } });
    if (!x.matchedCount) throw notYours();
    if (j.input) await store.remove(j.input.key);
    return [200, { ok: true, job_id: j._id, status: "failed", error: "storage_full" }];
  }
  // This upload's own key (clipKey has a random part): a retry after a failed upload, or a second /done racing this one,
  // never writes over or deletes this clip. The url is made when the client reads the job (clientJob), not here.
  const kept = { key: clipKey(j._id, j.leaseId, CLIP_TYPES[type]), bytes: r.buf.length, type };
  let x;
  try {
    await store.put(kept.key, r.buf);
    x = await jobsOf(d).updateOne(mine, {
      $set: { ...finished, status: "done", progress: 1, clip: kept, bytes: kept.bytes, expiresAt: new Date(now + CLIP_KEEP_MS) },
    });
  } catch (err) {
    // The upload or the update failed: drop the clip (a half upload too) — unless the update did land and only its
    // answer was lost on the way back: then the job is done, as below.
    const after = await jobsOf(d).findOne({ _id: j._id }).catch(() => null);
    if (after?.clip?.key !== kept.key) {
      await store.remove(kept.key);
      throw err;
    }
    x = { matchedCount: 1 };
  }
  if (!x.matchedCount) {
    await store.remove(kept.key);
    throw notYours();
  }
  if (j.input) await store.remove(j.input.key);
  return [200, { ok: true, job_id: j._id, status: "done" }];
}

/** POST /worker/jobs/{id}/fail (worker): { error: "short text" } — final (only a lease that runs out puts a job back). */
async function failJob(ctx, id) {
  const { d, req, store, now } = ctx;
  await authed(d, req, "worker");
  const j = await leasedJob(d, req, id);
  await noteHeartbeat(d, now, j.worker ?? "worker");
  const body = await readJson(req);
  if (typeof body.error !== "string" || !body.error.trim()) throw invalid("error", "error: a short text.");
  const error = body.error.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, WAN_LIMITS.error);
  const x = await jobsOf(d).updateOne({ _id: j._id, status: "running", leaseId: j.leaseId }, {
    $set: { status: "failed", error, finishedAt: new Date(now), leaseId: null, leaseUntil: null, input: null, bytes: 0 },
  });
  if (!x.matchedCount) throw notYours();
  if (j.input) await store.remove(j.input.key);
  return [200, { ok: true, job_id: j._id, status: "failed" }];
}

const ROUTES = [
  ["POST", /^\/render$/, render],
  ["GET", /^\/render\/([^/]+)$/, renderStatus],
  ["GET", /^\/clips\/([^/]+)$/, clip],
  ["POST", /^\/worker\/claim$/, claim],
  ["POST", /^\/worker\/jobs\/([^/]+)\/progress$/, progress],
  ["POST", /^\/worker\/jobs\/([^/]+)\/done$/, done],
  ["POST", /^\/worker\/jobs\/([^/]+)\/fail$/, failJob],
];

/**
 * /30da/hub/… — /30da/hub/wan (tower 11), /30da/hub/desk (tower 14 · Agent Desk, src/lib/thirtyda-hub-desk.mjs) and
 * /30da/hub/ai (tower 15 · Local AI, src/lib/thirtyda-hub-ai.mjs), each loaded on its first call. Every answer is JSON (or a clip / a picture); nothing here sets or reads a cookie.
 */
export async function handleThirtyDaHub(req, res, url) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === "/30da/hub/verify/telegram" || path.startsWith("/30da/hub/verify/telegram/")) {
    return (await import("./thirtyda-hub-verify.mjs")).handleVerification(req, res, path);
  }
  if (path === "/30da/hub/desk" || path.startsWith("/30da/hub/desk/")) {
    return (await import("./thirtyda-hub-desk.mjs")).handleDesk(req, res, path);
  }
  if (path === "/30da/hub/ai" || path.startsWith("/30da/hub/ai/")) {
    return (await import("./thirtyda-hub-ai.mjs")).handleAi(req, res, path);
  }
  const ctx = { req, res, sent: false };
  try {
    if (path !== WAN_BASE && !path.startsWith(`${WAN_BASE}/`)) throw fail(404, "not_found", "No such endpoint.");
    const sub = path.slice(WAN_BASE.length) || "/";
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
    ctx.store = hubStore();
    ctx.now = clock();
    await maybeSweep(ctx.d, ctx.store, ctx.now);
    const out = await hit[0](ctx, hit[1]);
    if (ctx.sent) return;
    const [status, body] = out;
    if (body == null) {
      res.writeHead(status, BASE_HEADERS);
      res.end();
      return;
    }
    sendJson(res, status, body);
  } catch (err) {
    if (res.headersSent) return;
    // Only a body over its limit (413) closes the connection unread. Every other refusal (401, 409, 429, 503 …, often
    // thrown before the body is read) keeps it open and reads the body to its end, dropping it: closing with the body
    // still coming resets the socket, and many clients (Node's fetch) then lose the answer.
    const tooBig = err instanceof HubError && err.code === "too_large";
    const close = tooBig ? { Connection: "close" } : {};
    if (!tooBig) req.resume();
    if (err instanceof HubError) {
      sendJson(res, err.status, { error: err.code, message: err.message, ...err.extra }, { ...err.headers, ...close });
      return;
    }
    console.error("[30da hub wan]", req.method, path, err instanceof Error ? err.message : err);
    sendJson(res, 500, { error: "server_error", message: "Something went wrong. Try again." }, close);
  }
}

// ---------------------------------------------------------------- the admin's tower (src/lib/thirtyda-admin.mjs)

/** Tower 11's status: not_set (a token missing) · off · waiting (for the M5) · live (the M5 called in ≤ 2 min ago). */
export function wanStatus({ clientSet, workerSet, enabled, seenAt, now }) {
  if (!clientSet || !workerSet) return "not_set";
  if (!enabled) return "off";
  return seenAt && now - new Date(seenAt).getTime() <= LIVE_MS ? "live" : "waiting";
}

/** A job as the tower lists it: never a prompt, a picture, a lease or the client's key. */
function adminJob(j) {
  const playable = j.source === "try" && j.status === "done" && j.clip;
  return {
    id: j._id,
    status: j.status,
    source: j.source,
    size: j.size,
    seconds: j.seconds,
    aspect: j.aspect,
    progress: j.status === "running" ? j.progress ?? 0 : j.status === "done" ? 1 : null,
    attempts: j.attempts ?? 0,
    createdAt: isoOf(j.createdAt),
    startedAt: isoOf(j.startedAt),
    finishedAt: isoOf(j.finishedAt),
    expiresAt: isoOf(j.expiresAt),
    error: j.status === "failed" ? j.error || "failed" : null,
    clipUrl: playable ? `${ADMIN_CLIPS}/${j._id}` : null,
    clipType: playable ? j.clip.type : null,
  };
}

/**
 * The Code page's "wan" block: status, the worker's last claim, the queue, the tokens' last 4 + made-at, the options,
 * the last 8 jobs and the latest Try. Never a token, a token's hash, a prompt or a picture.
 */
export async function wanAdminView(d, req) {
  const now = clock();
  const store = hubStore();
  await maybeSweep(d, store, now);
  try {
    // A write on a read page: when Mongo refuses writes (the M0 over its 512 MB), the tower (and the other ten) still show.
    await requeueLapsed(d, store, now);
  } catch (err) {
    console.error("[30da hub wan] requeue:", err instanceof Error ? err.message : err);
  }
  const [client, worker, seen] = await Promise.all([
    tokenStatus(d, WAN_TOKENS.client), tokenStatus(d, WAN_TOKENS.worker), settingsOf(d).findOne({ _id: SEEN_ID }),
  ]);
  const options = await wanOptions(d, { clientSet: client.set });
  const jobs = jobsOf(d);
  const [pending, running, recent, lastTry, stored, clips] = await Promise.all([
    jobs.countDocuments({ status: "pending" }),
    jobs.countDocuments({ status: "running" }),
    jobs.find({}).sort({ createdAt: -1 }).limit(8).toArray(),
    jobs.findOne({ source: "try" }, { sort: { createdAt: -1 } }),
    storedBytes(d),
    jobs.countDocuments({ status: "done", clip: { $ne: null } }),
  ]);
  const seenAt = seen?.at ? new Date(seen.at) : null;
  return {
    status: wanStatus({ clientSet: client.set, workerSet: worker.set, enabled: options.enabled, seenAt, now }),
    endpoint: `${publicOrigin(req)}${WAN_BASE}`,
    contract: "v1",
    worker: seenAt ? {
      seenAt: seenAt.toISOString(),
      seenAgoS: Math.max(0, Math.round((now - seenAt.getTime()) / 1000)),
      name: seen.worker ?? null,
      info: workerInfo(seen.info),
    } : null,
    queue: { pending, running, clips, storedBytes: stored, storageMax: WAN_LIMITS.storage, max: WAN_LIMITS.queue },
    tokens: { client, worker },
    options: { ...options, sizesAll: WAN_SIZES, secondsMax: SECONDS_MAX },
    limits: { perHour: WAN_LIMITS.perHour, keepHours: CLIP_KEEP_MS / 3600e3, leaseMinutes: LEASE_MS / 60e3 },
    jobs: recent.map(adminJob),
    lastTry: lastTry ? adminJob(lastTry) : null,
  };
}

/** "New token" (kind 'client' | 'worker'): the old one stops at once. → { token, view } — the only time the token is out. */
export async function newWanToken(d, kind, { by = "superadmin" } = {}) {
  if (!WAN_TOKENS[kind]) throw new Error(`No such token: ${String(kind).slice(0, 20)}`);
  return makeToken(d, WAN_TOKENS[kind], { by });
}

/** "Revoke" (kind 'client' | 'worker') → { removed }. */
export async function revokeWanToken(d, kind) {
  if (!WAN_TOKENS[kind]) throw new Error(`No such token: ${String(kind).slice(0, 20)}`);
  return removeToken(d, WAN_TOKENS[kind]);
}

/** Admin "Try": a render of the 30+DA home picture with a short prompt, source 'try', under the same caps. → { job_id }. */
export async function queueWanTry(d) {
  const now = clock();
  const store = hubStore();
  try {
    const client = (await tokenStatus(d, WAN_TOKENS.client)).set;
    const options = await wanOptions(d, { clientSet: client });
    await gate(d, options, "try", now);
    // The smallest size the tower has on, 3 seconds (or fewer, if that is the most): quick on the M5.
    const size = WAN_SIZES.find((s) => options.sizes[s]) ?? "480p";
    const fields = renderFields({ prompt: TRY_PROMPT, size, seconds: Math.min(3, options.maxSeconds), aspect: "9:16" }, options);
    const jpeg = await normalizeWanImage(await readFile(TRY_IMAGE));
    return { ok: true, job_id: await queueJob(d, store, { jpeg, fields, source: "try", client: "try", now }) };
  } catch (err) {
    if (err instanceof HubError) return { ok: false, status: err.status, reason: err.code, error: err.message };
    throw err;
  }
}

/** A Try's clip for the admin's player: { buf, type }, or null (no such Try, not done, or swept). Client clips never. */
export async function wanTryClip(d, id) {
  const j = JOB_ID_RE.test(String(id)) ? await jobsOf(d).findOne({ _id: id }) : null;
  if (!j || j.source !== "try" || j.status !== "done" || !j.clip) return null;
  const buf = await hubStore().get(j.clip.key);
  return buf ? { buf, type: j.clip.type } : null;
}
