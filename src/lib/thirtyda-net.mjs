/**
 * 30+DA: the caller's IP address for rate limits and the admin audit log.
 *
 * X-Forwarded-For is only believed when the connection itself comes from a proxy
 * (a loopback or private address, as on Railway), and then only the entry that
 * proxy added: the RIGHTMOST one. Anything to its left was sent by the client and
 * can say whatever it likes, so keying a limit on the leftmost entry lets a caller
 * pick a fresh "IP" for every request.
 *
 * THIRTYDA_PROXY_HOPS (default 1) = how many trusted proxies append to the header.
 */

const HOPS = Math.max(1, Number.parseInt(process.env.THIRTYDA_PROXY_HOPS ?? "1", 10) || 1);

function isPrivate(addr) {
  const a = String(addr || "").toLowerCase().replace(/^::ffff:/, "");
  if (a === "::1" || a.startsWith("127.") || a.startsWith("10.") || a.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(a)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a)) return true; // carrier-grade NAT (platform networks)
  return /^f[cd][0-9a-f]{2}:/.test(a) || a.startsWith("fe80:");
}

export function clientIp(req) {
  const peer = req.socket?.remoteAddress || "unknown";
  if (!isPrivate(peer)) return peer;
  const chain = String(req.headers["x-forwarded-for"] || "").split(",").map((s) => s.trim()).filter(Boolean);
  return chain.length ? chain[Math.max(0, chain.length - HOPS)] : peer;
}
