/**
 * Transactional email sender for the 3una 5aha app.
 *
 * Uses Resend's HTTP API (works from Railway, unlike SMTP which Railway
 * blocks). Configured via a single env var on the Railway `web` service:
 *
 *   RESEND_API_KEY   — from resend.com/api-keys
 *   RESEND_FROM      — optional; defaults to "onboarding@resend.dev".
 *                       Set to "3una 5aha <verify@ggmt.sg>" once the
 *                       ggmt.sg domain is verified in Resend.
 *
 * When RESEND_API_KEY is missing (local dev), the send stubs to
 * console.log and returns { ok:true, dev:true } so the sign-up flow
 * keeps working end-to-end without failing.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function fromAddress() {
  return process.env.RESEND_FROM || "3una 5aha · තුන පහ <noreply@ggmt.sg>";
}

/** 6-digit numeric code, first digit ≥1 so display never looks truncated. */
export function newCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function codeEmailHtml({ heading, sub, code, footer }) {
  return `<div style="font-family:-apple-system,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;padding:22px;color:#222">
    <h2 style="margin:0 0 8px;font-size:22px">${heading}</h2>
    <p style="color:#555;margin:0 0 6px">${sub}</p>
    <div style="font-size:34px;letter-spacing:7px;font-weight:700;text-align:center;padding:20px;background:#faf7f4;border-radius:10px;margin:18px 0;color:#d9542b">${code}</div>
    <p style="color:#666;font-size:13px;line-height:1.55">${footer}</p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0 12px">
    <p style="color:#999;font-size:12px;line-height:1.5">3una 5aha — non-commercial community app for Sri Lankan food. Published by <a href="https://www.ggmt.sg" style="color:#999">www.ggmt.sg</a> (GGMT PTE. LTD., Singapore).</p>
  </div>`;
}

async function sendViaResend({ to, subject, text, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.log(`[mail:dev] would send "${subject}" → ${to}`); return { ok: true, dev: true }; }
  try {
    const r = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: fromAddress(), to: [to], subject, text, html }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      console.error(`[mail] Resend HTTP ${r.status} for ${to}: ${body.slice(0, 300)}`);
      return { ok: false, error: `Resend HTTP ${r.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.error(`[mail] Resend send failed for ${to}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

/** Send the 6-digit signup/verify code. */
export async function sendVerificationEmail(to, code) {
  return sendViaResend({
    to,
    subject: `${code} — verify your 3una 5aha email`,
    text: `Your 3una 5aha verification code is: ${code}\n\nEnter it in the app within 24 hours to verify your email. If you didn't sign up, you can ignore this message.\n\n— 3una 5aha · GGMT PTE. LTD.`,
    html: codeEmailHtml({
      heading: "Verify your email",
      sub: "Your 3una 5aha verification code:",
      code,
      footer: "Enter it in the app within 24 hours. If you didn't sign up for 3una 5aha, you can ignore this message.",
    }),
  });
}

/** Send the 6-digit password-reset code. */
export async function sendPasswordResetEmail(to, code) {
  return sendViaResend({
    to,
    subject: `${code} — reset your 3una 5aha password`,
    text: `Your 3una 5aha password reset code is: ${code}\n\nEnter it on the reset page within 24 hours to set a new password. If you didn't request this, ignore this message and your password stays the same.\n\n— 3una 5aha · GGMT PTE. LTD.`,
    html: codeEmailHtml({
      heading: "Reset your password",
      sub: "Your 3una 5aha password reset code:",
      code,
      footer: "Enter it on the reset page within 24 hours. If you didn't request this, ignore this message and your password stays the same.",
    }),
  });
}
