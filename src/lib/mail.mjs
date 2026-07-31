/**
 * Transactional email sender for the 3una 5aha app.
 *
 * Configured via env vars (set on Railway `web` service):
 *   SMTP_HOST  — smtp.zoho.com
 *   SMTP_PORT  — 465 (SSL) or 587 (STARTTLS); defaults to 465
 *   SMTP_USER  — gk.smart@ggmt.sg
 *   SMTP_PASS  — the Zoho account password (or app password if TFA on)
 *   SMTP_FROM  — optional; defaults to SMTP_USER
 *
 * When any of SMTP_HOST/USER/PASS is missing (typical local dev), the
 * send stubs to console.log and returns { ok:true, dev:true } so the
 * app keeps working end-to-end without failing the sign-up flow.
 */

import nodemailer from "nodemailer";

let cached = null;

function getTransporter() {
  if (cached) return cached;
  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  const port = Number(process.env.SMTP_PORT || 465);
  cached = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465, // SSL for 465, STARTTLS for 587
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return cached;
}

/** 6-digit numeric code, first digit ≥1 so display never looks truncated. */
export function newCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function codeEmail({ heading, sub, code, footer }) {
  return `<div style="font-family:-apple-system,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;padding:22px;color:#222">
    <h2 style="margin:0 0 8px;font-size:22px">${heading}</h2>
    <p style="color:#555;margin:0 0 6px">${sub}</p>
    <div style="font-size:34px;letter-spacing:7px;font-weight:700;text-align:center;padding:20px;background:#faf7f4;border-radius:10px;margin:18px 0;color:#d9542b">${code}</div>
    <p style="color:#666;font-size:13px;line-height:1.55">${footer}</p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0 12px">
    <p style="color:#999;font-size:12px;line-height:1.5">3una 5aha — non-commercial community app for Sri Lankan food. Published by <a href="https://www.ggmt.sg" style="color:#999">www.ggmt.sg</a> (GGMT PTE. LTD., Singapore).</p>
  </div>`;
}

/** Send the 6-digit signup/verify code. */
export async function sendVerificationEmail(to, code) {
  const t = getTransporter();
  if (!t) { console.log(`[mail:dev] verification code ${code} → ${to}`); return { ok: true, dev: true }; }
  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject: `${code} — verify your 3una 5aha email`,
      text: `Your 3una 5aha verification code is: ${code}\n\nEnter it in the app within 24 hours to verify your email. If you didn't sign up, you can ignore this message.\n\n— 3una 5aha · GGMT PTE. LTD.`,
      html: codeEmail({
        heading: "Verify your email",
        sub: "Your 3una 5aha verification code:",
        code,
        footer: "Enter it in the app within 24 hours. If you didn't sign up for 3una 5aha, you can ignore this message.",
      }),
    });
    return { ok: true };
  } catch (e) {
    console.error(`[mail] verification send failed for ${to}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

/** Send the 6-digit password-reset code. */
export async function sendPasswordResetEmail(to, code) {
  const t = getTransporter();
  if (!t) { console.log(`[mail:dev] reset code ${code} → ${to}`); return { ok: true, dev: true }; }
  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject: `${code} — reset your 3una 5aha password`,
      text: `Your 3una 5aha password reset code is: ${code}\n\nEnter it on the reset page within 24 hours to set a new password. If you didn't request this, ignore this message and your password stays the same.\n\n— 3una 5aha · GGMT PTE. LTD.`,
      html: codeEmail({
        heading: "Reset your password",
        sub: "Your 3una 5aha password reset code:",
        code,
        footer: "Enter it on the reset page within 24 hours. If you didn't request this, ignore this message and your password stays the same.",
      }),
    });
    return { ok: true };
  } catch (e) {
    console.error(`[mail] reset send failed for ${to}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}
