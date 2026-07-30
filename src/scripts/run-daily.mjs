/**
 * Daily pipeline runner. Runs every stage in its own child process with a
 * hard time limit — one stage hanging or crashing can never block the rest.
 *
 * Replaces the old `npm run a && npm run b && ...` chain, which had a bug:
 * `fetch` had no `|| true`, so if it ever failed outright the whole chain
 * stopped before gov/telegram/govcast/podcast ran at all. Node's own
 * child_process is used instead of the shell `timeout` command, which isn't
 * guaranteed to exist on the Nixpacks build image.
 *
 * Usage: npm run daily
 */

import { spawn } from "node:child_process";

const STAGES = [
  { name: "fetch", script: "npm run fetch", maxMs: 5 * 60_000 },
  { name: "ai-countries", script: "npm run ai-countries", maxMs: 8 * 60_000 },
  { name: "gov", script: "npm run gov", maxMs: 5 * 60_000 },
  { name: "telegram", script: "npm run telegram", maxMs: 5 * 60_000 },
  { name: "brands", script: "npm run brands", maxMs: 15 * 60_000 },
  { name: "garment-press", script: "npm run garment-press", maxMs: 5 * 60_000 },
  { name: "govcast", script: "npm run govcast", maxMs: 3 * 60_000 },
  { name: "podcast", script: "npm run podcast", maxMs: 3 * 60_000 },
];

function runStage({ name, script, maxMs }) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const [cmd, ...args] = script.split(" ");
    const child = spawn(cmd, args, { stdio: "inherit", shell: false });
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      console.error(`[daily] ${name}: exceeded ${maxMs / 1000}s — killing`);
      child.kill("SIGKILL");
      resolve({ name, ok: false, secs: (Date.now() - t0) / 1000, reason: "timeout" });
    }, maxMs);

    child.on("exit", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ name, ok: code === 0, secs: (Date.now() - t0) / 1000, reason: code === 0 ? null : `exit ${code}` });
    });
    child.on("error", (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ name, ok: false, secs: (Date.now() - t0) / 1000, reason: err.message });
    });
  });
}

async function main() {
  console.log(`[daily] starting ${STAGES.length} stages — ${new Date().toISOString()}`);
  const results = [];
  for (const stage of STAGES) {
    console.log(`\n[daily] ▶ ${stage.name}`);
    const r = await runStage(stage);
    results.push(r);
    console.log(`[daily] ${r.ok ? "✓" : "✗"} ${stage.name} (${r.secs.toFixed(1)}s)${r.reason ? ` — ${r.reason}` : ""}`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n[daily] done: ${results.length - failed.length}/${results.length} stages OK` +
      (failed.length ? ` — failed: ${failed.map((r) => r.name).join(", ")}` : ""),
  );
  // Never fail the whole cron run — a partial day is better than none.
  process.exit(0);
}

main();
