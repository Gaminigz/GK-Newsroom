/**
 * Brand Scout — LOCAL page (no code gate; the deployed twin lives at /leads
 * behind LEADS_CODE). Same renderers as the web version (src/lib/leads.mjs):
 * A→Z directory + per-brand detail pages.
 *
 * Usage:
 *   npm run brands-page          → http://localhost:8793
 *
 * Data comes from `npm run brands` (see run-brand-scout.mjs).
 */

import http from "node:http";
import { getDb } from "../lib/mongo.ts";
import { renderDirectory, renderBrandPage, STATUSES } from "../lib/leads.mjs";

const PORT = Number(process.env.PORT || 8793);

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => { buf += c; if (buf.length > 50_000) reject(new Error("too large")); });
    req.on("end", () => resolve(new URLSearchParams(buf)));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname === "/status" && req.method === "POST") {
      const form = await readBody(req);
      const slug = form.get("slug");
      const status = STATUSES.includes(form.get("status")) ? form.get("status") : "new";
      const notes = (form.get("notes") || "").slice(0, 2000);
      const db = await getDb();
      await db.collection("brands").updateOne({ _id: slug }, { $set: { status, notes } });
      res.writeHead(303, { Location: `/b/${encodeURIComponent(slug)}` });
      res.end();
      return;
    }
    const bm = url.pathname.match(/^\/b\/([a-z0-9-]+)$/);
    if (bm) {
      const page = await renderBrandPage(bm[1], { backPath: "/", postPath: "/status" });
      if (!page) {
        res.writeHead(404).end("unknown brand");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(page);
      return;
    }
    if (url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(await renderDirectory({ brandPath: "/b/", homeLinks: false }));
      return;
    }
    res.writeHead(404).end("not found");
  } catch (e) {
    res.writeHead(500).end("error: " + (e instanceof Error ? e.message : String(e)));
  }
});

server.listen(PORT, () => {
  console.log(`Brand Scout (local) → http://localhost:${PORT}`);
});
