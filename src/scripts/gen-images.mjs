/**
 * Generate the site's images with Gemini Imagen — run ONCE on a machine
 * with GEMINI_API_KEY + network (they're committed to the repo after):
 *
 *   1. src/web-assets/tile-food.png / tile-ai.png — glossy 3D landing icons.
 *   2. src/web-assets/tile-acct.png — downloaded from the user's Google
 *      Drive share (the official GK SMART Ai logo), not generated.
 *   3. src/web-assets/spices/<id>.jpg — one food-photography shot per
 *      spice (~800px, on-topic by construction, no more search roulette).
 *
 * Idempotent: existing files are skipped (use --force to redo all).
 * Cost ≈ $0.04 per generated image (~$1 for the full set, one-time).
 *
 * Usage:
 *   npm run genimages
 *   npm run genimages -- --force
 */

import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SPICES } from "../data/spices.ts";

const FORCE = process.argv.includes("--force");
const OUT = path.resolve("src/web-assets");
const IMAGE_MODEL = "imagen-3.0-generate-002";
const GK_LOGO_DRIVE_ID = "1btgfaoPGs-Et9nIym7mJluqYoHyKV9YH";

// Spices whose name alone would mislead the image model.
const SPICE_NOUNS = {
  "thuna-paha": "a bowl of golden-brown Sri Lankan raw curry powder with whole coriander, cumin and fennel seeds around it",
  "roasted-curry-powder": "a bowl of very dark roasted Sri Lankan curry powder, deep brown, with roasted spices scattered",
  "goraka": "dried black Garcinia gummi-gutta fruit segments (goraka), wrinkled dark dried fruit pieces",
  "curry-powder-unroasted": "a bowl of pale yellow mild curry powder with coconut milk in the background",
  "mace": "crimson-red mace arils (the lacy covering of nutmeg seeds)",
  "sweet-cumin": "caraway seeds in a small wooden scoop",
  "curry-leaves": "a fresh sprig of glossy green curry leaves (Murraya koenigii)",
  "pandan": "long green pandan leaves tied in a knot",
};

function spicePrompt(s) {
  const noun = SPICE_NOUNS[s.id] ?? `${s.name} spice, clearly recognizable`;
  return `Professional food photography, ${noun}, Sri Lankan kitchen setting, rustic dark wood surface, warm side light, shallow depth of field, macro detail, rich colors. No people, no hands, no text, no watermark, no labels.`;
}

const TILES = [
  {
    file: "tile-food.png",
    prompt:
      "Glossy 3D mobile app icon, a steaming clay bowl of Sri Lankan curry surrounded by colorful spices (cinnamon quills, chili, cardamom), warm orange tones, soft studio lighting, rounded square icon on transparent background, high detail render. No text.",
  },
  {
    file: "tile-ai.png",
    prompt:
      "Glossy 3D mobile app icon, a friendly cute robot head with glowing green eyes, deep blue metallic finish, soft studio lighting, rounded square icon on transparent background, high detail render. No text.",
  },
];

async function generate(ai, prompt, aspectRatio) {
  const res = await ai.models.generateImages({
    model: IMAGE_MODEL,
    prompt,
    config: { numberOfImages: 1, aspectRatio },
  });
  const b64 = res.generatedImages?.[0]?.image?.imageBytes;
  if (!b64) throw new Error("no image returned");
  return Buffer.from(b64, "base64");
}

async function downloadGkLogo() {
  const dest = path.join(OUT, "tile-acct.png");
  if (existsSync(dest) && !FORCE) return console.log("skip tile-acct.png (exists)");
  const url = `https://drive.google.com/uc?export=download&id=${GK_LOGO_DRIVE_ID}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Drive download HTTP ${res.status} — is the file shared "anyone with link"?`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000 || buf.subarray(0, 100).toString().includes("<!DOCTYPE")) {
    throw new Error("Drive returned an HTML page, not the image — open the share link once and confirm public access");
  }
  await sharp(buf).resize(240, 240, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(dest);
  console.log("✓ tile-acct.png (GK SMART Ai logo from Drive)");
}

async function main() {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  mkdirSync(path.join(OUT, "spices"), { recursive: true });

  await downloadGkLogo().catch((e) => console.log("✗ GK logo:", e.message));

  for (const t of TILES) {
    const dest = path.join(OUT, t.file);
    if (existsSync(dest) && !FORCE) { console.log(`skip ${t.file} (exists)`); continue; }
    try {
      const png = await generate(ai, t.prompt, "1:1");
      await sharp(png).resize(240, 240).png().toFile(dest);
      console.log(`✓ ${t.file}`);
    } catch (e) {
      console.log(`✗ ${t.file}: ${e.message}`);
    }
  }

  let ok = 0, fail = 0;
  for (const s of SPICES) {
    const dest = path.join(OUT, "spices", `${s.id}.jpg`);
    if (existsSync(dest) && !FORCE) { console.log(`skip ${s.id} (exists)`); ok++; continue; }
    try {
      const png = await generate(ai, spicePrompt(s), "16:9");
      await sharp(png).resize(800, 450).jpeg({ quality: 80 }).toFile(dest);
      console.log(`✓ spices/${s.id}.jpg`);
      ok++;
    } catch (e) {
      console.log(`✗ ${s.id}: ${e.message}`);
      fail++;
    }
  }
  console.log(`done — ${ok} ok, ${fail} failed. Now: git add src/web-assets && commit && push.`);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
