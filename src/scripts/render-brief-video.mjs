/**
 * Renders today's "Yai Ai Brief" as a 9:16 video — the daily branded
 * photo card + a slice of the podcast episode as the soundtrack. This
 * replaces YouTube's in-app Ai-create step: the output uploads directly
 * as a Short (or a TikTok video post).
 *
 *   photo (render-brief-photo.mjs) ──┐
 *                                    ├── ffmpeg ──► brief.mp4 (1080×1920)
 *   podcast audio (Mongo) ───────────┘
 *
 * Requires ffmpeg on PATH (macOS: `brew install ffmpeg`) or FFMPEG_PATH
 * pointing at a binary. Output codec follows the extension: .mp4 →
 * H.264 + AAC (what YouTube/TikTok want), .webm → VP8 (test builds).
 *
 * Usage:
 *   npm run video                        → ./brief.mp4, 30s from audio start
 *   npm run video -- --out out/x.mp4 --start 20 --duration 45
 *   npm run video -- --photo my.png      → skip photo render, use this image
 *   npm run video -- --no-audio          → silent video (no podcast needed)
 */

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getEpisodeAudio, listEpisodes, todayKey } from "../lib/podcast.ts";
import { closeDb } from "../lib/mongo.ts";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const OUT = path.resolve(arg("out", "brief.mp4"));
const START = Number(arg("start", 0));
const DURATION = Number(arg("duration", 30));
const PHOTO = arg("photo", null);
const NO_AUDIO = flag("no-audio");
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "inherit", "inherit"], ...opts });
    p.on("error", (e) =>
      reject(
        e.code === "ENOENT"
          ? new Error(`${cmd} not found — install ffmpeg (brew install ffmpeg) or set FFMPEG_PATH`)
          : e
      )
    );
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

async function main() {
  const tmp = mkdtempSync(path.join(tmpdir(), "brief-video-"));
  try {
    // 1. The image: today's rendered brief card, or a caller-supplied photo.
    let photo = PHOTO ? path.resolve(PHOTO) : null;
    if (!photo) {
      photo = path.join(tmp, "photo.png");
      console.log("rendering today's brief photo…");
      await run(process.execPath, [
        "node_modules/tsx/dist/cli.mjs",
        "src/scripts/render-brief-photo.mjs",
        photo,
      ]);
    }
    if (!existsSync(photo)) throw new Error(`photo not found: ${photo}`);

    // 2. The soundtrack: today's episode, else the latest ready one.
    let audio = null;
    if (!NO_AUDIO) {
      let buf = await getEpisodeAudio(todayKey());
      if (!buf) {
        const latest = (await listEpisodes(1))[0];
        const key = latest?.dateKey ?? latest?._id;
        if (key) {
          console.log(`no episode for today — using latest ready (${key})`);
          buf = await getEpisodeAudio(key);
        }
      }
      if (!buf) throw new Error("no ready podcast episode in Mongo (or pass --no-audio)");
      audio = path.join(tmp, "audio.wav");
      writeFileSync(audio, buf);
    }

    // 3. ffmpeg: loop the still for DURATION, slice audio from START, fade
    //    audio in/out so the cut doesn't pop. yuv420p is required — TikTok
    //    and YouTube reject 4:4:4 stills-derived streams.
    const webm = OUT.toLowerCase().endsWith(".webm");
    const args = ["-y", "-loop", "1", "-framerate", "30", "-i", photo];
    if (audio) args.push("-ss", String(START), "-i", audio);
    args.push(
      "-t", String(DURATION),
      "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
      ...(webm ? ["-c:v", "libvpx", "-b:v", "2M"] : ["-c:v", "libx264", "-preset", "medium", "-crf", "21"])
    );
    if (audio) {
      const fadeOutAt = Math.max(0, DURATION - 2);
      args.push(
        "-af", `afade=t=in:d=0.5,afade=t=out:st=${fadeOutAt}:d=2`,
        ...(webm ? [] : ["-c:a", "aac", "-b:a", "128k"]),
        "-shortest"
      );
    }
    args.push(OUT);

    console.log("encoding video…");
    await run(FFMPEG, args);

    const mb = (statSync(OUT).size / 1e6).toFixed(1);
    console.log(`done: ${OUT} (${DURATION}s, ${mb} MB)`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    await closeDb().catch(() => {});
  }
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
