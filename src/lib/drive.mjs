/**
 * Google Drive storage for shop-uploaded dish photos.
 *
 * Uses a single service account (see GOOGLE_DRIVE_CREDENTIALS_JSON env var)
 * that owns a root folder (GOOGLE_DRIVE_FOLDER_ID) into which every photo is
 * uploaded. Each uploaded file is made publicly readable so the embed URL
 * https://lh3.googleusercontent.com/d/<fileId> resolves directly to the image
 * for buyer browsers.
 *
 * When credentials are missing, uploadDishPhoto() returns null and the caller
 * falls back to storing the base64 data URI on the dish doc — same behavior
 * as before the integration, so the app never breaks in dev.
 */

import { google } from "googleapis";

let driveClient = null;
let clientInitFailed = false;

function initDrive() {
  if (driveClient || clientInitFailed) return driveClient;
  const raw = process.env.GOOGLE_DRIVE_CREDENTIALS_JSON;
  if (!raw) { clientInitFailed = true; return null; }
  try {
    const creds = JSON.parse(raw);
    const auth = new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    });
    driveClient = google.drive({ version: "v3", auth });
    return driveClient;
  } catch (e) {
    console.error("[drive] init failed:", e.message);
    clientInitFailed = true;
    return null;
  }
}

/** Decode a `data:image/jpeg;base64,...` URI to a Buffer, or null if invalid. */
function decodeDataUri(dataUri) {
  const m = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUri || "");
  if (!m) return null;
  return { mimeType: m[1], buffer: Buffer.from(m[2], "base64") };
}

/** Upload a dish photo. Returns `https://lh3.googleusercontent.com/d/<id>` on
 *  success, or null if Drive is not configured or the payload is invalid. */
export async function uploadDishPhoto(dataUri, { shopId, dishName }) {
  const drive = initDrive();
  if (!drive) return null;
  const decoded = decodeDataUri(dataUri);
  if (!decoded) return null;
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) { console.warn("[drive] GOOGLE_DRIVE_FOLDER_ID not set"); return null; }

  const safeName = String(dishName || "dish").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 40) || "dish";
  const fileName = `${shopId}--${safeName}--${Date.now()}.jpg`;

  try {
    const { Readable } = await import("node:stream");
    const upload = await drive.files.create({
      requestBody: { name: fileName, parents: [folderId], mimeType: decoded.mimeType },
      media: { mimeType: decoded.mimeType, body: Readable.from(decoded.buffer) },
      fields: "id",
    });
    const fileId = upload.data.id;
    if (!fileId) return null;
    // Anyone with the link can read — needed for public lh3 URL to resolve.
    await drive.permissions.create({
      fileId,
      requestBody: { role: "reader", type: "anyone" },
    });
    return `https://lh3.googleusercontent.com/d/${fileId}`;
  } catch (e) {
    console.error("[drive] upload failed:", e.message);
    return null;
  }
}

/** Best-effort delete of a Drive-hosted photo when a dish is removed or its
 *  photo replaced. Silent no-op if the URL isn't ours or Drive is off. */
export async function deleteDishPhoto(photoUrl) {
  if (typeof photoUrl !== "string") return;
  const m = /lh3\.googleusercontent\.com\/d\/([A-Za-z0-9_-]+)/.exec(photoUrl);
  if (!m) return;
  const drive = initDrive();
  if (!drive) return;
  try { await drive.files.delete({ fileId: m[1] }); }
  catch (e) { console.warn("[drive] delete failed:", e.message); }
}
