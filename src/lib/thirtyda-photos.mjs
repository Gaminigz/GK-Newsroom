/**
 * 30+DA photo store.
 *
 * Every upload is re-encoded with sharp: JPEG, at most 720 px on the long
 * side, EXIF stripped (no GPS leaves the phone through us). Photos are never
 * public URLs — the app serves them through GET /30da/api/photos/:id after an
 * access check.
 *
 * Backend by THIRTYDA_PHOTO_STORE:
 *   local (default)  files in <repo>/.data/30da-photos/ (gitignored)
 *   mongo            GridFS bucket `thirtyda_photos`
 */

import crypto from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import sharp from "sharp";
import { GridFSBucket } from "mongodb";
import { getDb } from "./mongo.ts";

const STORE = process.env.THIRTYDA_PHOTO_STORE === "mongo" ? "mongo" : "local";
const DIR = new URL("../../.data/30da-photos/", import.meta.url);
const MAX_PX = 720;
const ID_RE = /^[a-f0-9]{32}$/;

export const isPhotoId = (id) => typeof id === "string" && ID_RE.test(id);

export class PhotoError extends Error {}

/** Decode, auto-rotate, shrink and re-encode. Throws PhotoError on anything that is not an image. */
export async function normalizePhoto(buffer) {
  try {
    return await sharp(buffer, { failOn: "error", limitInputPixels: 50e6 })
      .rotate() // apply EXIF orientation before the metadata is dropped
      .resize({ width: MAX_PX, height: MAX_PX, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new PhotoError("That file is not a photo we can read.");
  }
}

let bucket = null;
async function gridfs() {
  if (!bucket) bucket = new GridFSBucket(await getDb(), { bucketName: "thirtyda_photos" });
  return bucket;
}

/** Store a photo, returns its id. */
export async function savePhoto(buffer) {
  const jpeg = await normalizePhoto(buffer);
  const id = crypto.randomBytes(16).toString("hex");
  if (STORE === "mongo") {
    const b = await gridfs();
    await new Promise((resolve, reject) => {
      const up = b.openUploadStreamWithId(id, `${id}.jpg`, { metadata: { contentType: "image/jpeg" } });
      up.on("error", reject).on("finish", resolve);
      up.end(jpeg);
    });
  } else {
    await mkdir(DIR, { recursive: true });
    await writeFile(new URL(`${id}.jpg`, DIR), jpeg);
  }
  return id;
}

/** The JPEG bytes, or null when there is no such photo. */
export async function readPhoto(id) {
  if (!isPhotoId(id)) return null;
  try {
    if (STORE === "mongo") {
      const b = await gridfs();
      const chunks = [];
      for await (const c of b.openDownloadStream(id)) chunks.push(c);
      return Buffer.concat(chunks);
    }
    return await readFile(new URL(`${id}.jpg`, DIR));
  } catch {
    return null;
  }
}

export async function deletePhoto(id) {
  if (!isPhotoId(id)) return;
  try {
    if (STORE === "mongo") await (await gridfs()).delete(id);
    else await unlink(new URL(`${id}.jpg`, DIR));
  } catch {
    // Already gone.
  }
}
