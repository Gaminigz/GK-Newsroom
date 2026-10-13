/**
 * 30+DA small public pages, served by src/lib/thirtyda-app.mjs in the app's look (src/thirtyda-app/pages.css):
 *
 *   GET /30da/privacy        the privacy policy (Google and Facebook ask for its address)
 *   GET /30da/delete-data    how to have your data deleted (Facebook asks for its address)
 *   the admin's "Try sign-in" result (the end of GET /30da/api/auth/<provider>/callback for a test)
 *
 * Plain English, short, true to what the code does. Static text apart from the try page, where every value
 * from Google / Facebook is escaped. Pure: no database, no request.
 */

export const CONTACT_EMAIL = "gk.smart@ggmt.sg";
export const POLICY_DATE = "13 October 2026";
const NAMES = { google: "Google", facebook: "Facebook" };

/** HTML-escape any text that did not come from this file. */
export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function page({ title, body, robots = "index", lang = "en", kind = "doc" }) {
  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#0b1c3f">
  <meta name="robots" content="${robots}">
  <title>${esc(title)}</title>
  <link rel="icon" href="data:,">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,400..900&family=JetBrains+Mono:wght@400..600&display=swap">
  <link rel="stylesheet" href="/30da/pages.css">
</head>
<body class="page-${kind}">
  <div class="doc">
    <header class="doc-bar"><a class="doc-mark" href="/30da/">30+DA</a></header>
    <main class="doc-body">
${body}
    </main>
  </div>
</body>
</html>
`;
}

const mail = `<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>`;

/** GET /30da/privacy */
export function privacyPage() {
  return page({
    title: "Privacy policy · 30+DA",
    body: `      <h1>Privacy policy</h1>
      <p class="doc-date">Updated ${POLICY_DATE}</p>
      <p class="doc-lede">30+DA is a calm dating app for people aged 30 and over. This page says what we keep about you, why,
        who else sees it, and how to have it deleted. Questions: ${mail}.</p>

      <h2>What we keep</h2>
      <ul>
        <li><b>Your profile:</b> app name, real name, birth year, gender, what you are looking for and your language.
          Your real name is shown to another person only after you both choose to open the chat.</li>
        <li><b>Your photos.</b> We remove the hidden camera and location details from them. Other people see more of your
          photos as your conversation with them goes up a level.</li>
        <li><b>How you signed in:</b> your phone number when you verify it with a code. If you use Google or Facebook,
          your account number there and your email address if they give it to us. We never keep your Google or
          Facebook password or their sign-in keys.</li>
        <li><b>Your area:</b> we store a point a few hundred metres away from where you really are, and show other people
          only your area and how far away you are.</li>
        <li><b>What you write in the app:</b> questions, answers and chat messages, and any message we stopped because it
          broke the rules (for example a phone number or a chat handle).</li>
        <li><b>Safety records:</b> reports you or others make, warnings, and when you were last online.</li>
      </ul>

      <h2>Why</h2>
      <p>To run the app: to sign you in, show you people near you, carry your conversations, translate them, and keep
        everyone safe (we stop contact details in messages and look at reports).</p>

      <h2>Who else sees it</h2>
      <ul>
        <li><b>Other members</b> see what the app shows them: your app name, the photos for your level, your area and
          distance, and what you write to them.</li>
        <li><b>The 30+DA team</b> sees profiles, stopped messages and reports, to keep the app safe.</li>
        <li><b>Telegram or WhatsApp (Meta)</b> get your phone number when you ask for a sign-in code by them, so they can
          deliver it.</li>
        <li><b>Google or Facebook</b> tell us who you are when you sign in with them.</li>
        <li>Messages are translated on <b>our own server</b>; they are not sent to an outside translation service.</li>
      </ul>
      <p>We do not sell your data and we do not show ads.</p>

      <h2>Cookies</h2>
      <p>One cookie keeps you signed in (for 30 days). A short one (10 minutes) protects a Google or Facebook sign-in.
        No tracking or advertising cookies.</p>

      <h2>How long we keep it</h2>
      <p>For as long as you have an account. Sign-in codes are gone within 15 minutes.
        To have your data deleted, see <a href="/30da/delete-data">Delete your data</a>.</p>

      <h2>Age</h2>
      <p>30+DA is only for people aged 30 and over.</p>

      <h2>Changes</h2>
      <p>If this policy changes, we update this page and the date at the top.</p>

      <p class="doc-contact">Contact: ${mail}</p>`,
  });
}

/** GET /30da/delete-data */
export function deleteDataPage() {
  return page({
    title: "Delete your data · 30+DA",
    body: `      <h1>Delete your data</h1>
      <p class="doc-lede">You can ask us to delete your 30+DA account and everything that belongs to it at any time.</p>

      <h2>How</h2>
      <ol class="doc-steps">
        <li>Email ${mail} with the subject <b>Delete my 30+DA account</b>.</li>
        <li>Tell us your app name and how you signed in: your phone number, or your Google or Facebook account.</li>
        <li>We delete your profile, photos, phone number, Google or Facebook link and location, sign you out everywhere,
          and email you when it is done — within 30 days.</li>
      </ol>
      <p>Signing out in the app (Me → Sign out) does not delete anything.</p>

      <h2>Signed in with Facebook or Google?</h2>
      <p>You can also take 30+DA's access away there: in Facebook, Settings &amp; privacy → Settings → Apps and websites →
        30+DA → Remove; in Google, myaccount.google.com → Security → Your connections to third-party apps → 30+DA →
        Delete all connections. That stops new sign-ins; email us as well so we delete what we already hold.</p>

      <p class="doc-contact">Questions: ${mail} · <a href="/30da/privacy">Privacy policy</a></p>`,
  });
}

// ---------- the admin's "Try sign-in" result ----------

const KEY_WORDS = { google: "Client ID or Client secret", facebook: "App ID or App secret" };
const WHERE_KEYS = {
  google: "Google Cloud → APIs &amp; Services → Credentials → your OAuth client",
  facebook: "Meta for Developers → your app → App settings → Basic",
};
const WHERE_REDIRECT = {
  google: "Google Cloud → APIs &amp; Services → Credentials → your OAuth client → Authorised redirect URIs",
  facebook: "Meta for Developers → your app → Facebook Login → Settings → Valid OAuth Redirect URIs",
};
const GO_LIVE = {
  google: "Google Cloud → APIs &amp; Services → OAuth consent screen: press Publish app (or, while it is in Testing, add your Google account under Test users).",
  facebook: "Meta for Developers → your app: switch App mode to Live (it needs the Privacy policy and Data deletion addresses from the Code page).",
};
/** What a good try proves (the owner got in) and what it cannot: an app still in Testing / Development lets only the owner in. */
const WORKS_KEYS = { google: "Client ID, Client secret", facebook: "App ID, App secret" };
const ONLY_YOU = {
  google: "If the Google app is still in Testing, only you and its test users can sign in — other people are stopped on Google’s own page.",
  facebook: "If the Facebook app is still in Development mode, only you and people with a role on the app can sign in — other people are stopped on Facebook’s own page.",
};
const OPEN_TO_ALL = {
  google: "To let everyone in: Google Cloud → APIs &amp; Services → OAuth consent screen → press Publish app.",
  facebook: "To let everyone in: Meta for Developers → your app → switch App mode to Live (it needs the Privacy policy and Data deletion addresses from the Code page).",
};

/** What went wrong, in plain words, and what to do about it. reason: see SIGNIN_REASONS + no_keys / admin_gone. */
function tryFailure(provider, reason) {
  const name = NAMES[provider];
  switch (reason) {
    case "cancelled":
      return [`You pressed Cancel, or ${name} did not let this account in.`,
        `Press Try sign-in again and pick your account. If ${name} said the app is not available to you: ${GO_LIVE[provider]}`];
    case "bad_keys":
      return [`${name} did not accept the ${KEY_WORDS[provider]}.`, `Copy both again from ${WHERE_KEYS[provider]}, save them on the Code page, then try again.`];
    case "redirect":
      return [`The redirect address is not added in ${name}.`, `Copy the redirect address from the ${name} card and add it in ${WHERE_REDIRECT[provider]}. Then try again.`];
    case "not_live":
      return [`The ${name} app is not open to everyone yet.`, GO_LIVE[provider]];
    case "expired":
      return ["This try took too long, or it came back to another browser.", "Press Try sign-in again and finish within 10 minutes, in this same browser."];
    case "timeout":
      return [`${name} did not answer in time.`, "Wait a minute and try again."];
    case "network":
      return [`This server could not reach ${name}.`, "Wait a minute and try again."];
    case "provider_error":
      return [`${name} did not answer properly.`, `This is a problem on ${name}’s side, not with your keys. Wait a minute and try again.`];
    case "no_keys":
      return [`No ${name} keys are saved.`, `Save the ${KEY_WORDS[provider].replace(" or ", " and ")} on the Code page first.`];
    case "admin_gone":
      return ["Your admin session ended before the try came back.", "Sign in to the admin again, then press Try sign-in."];
    case "too_many":
      return ["That is a lot of tries in a short time.", "Wait 15 minutes, then press Try sign-in again."];
    default:
      return [`${name} refused the sign-in.`, `Check the ${KEY_WORDS[provider]} and the redirect address on the Code page, then try again.`];
  }
}

/**
 * The page a "Try sign-in" ends on. Nothing was saved: no profile, no session.
 * ok → "Works ✓ — Google said: <name> (<email>)" + only what that proves: the keys and the redirect address work
 * (the owner got in). Whether everyone can get in depends on the app being published / Live, which the try cannot
 * see, so the page says so. Else the plain-words failure (+ what Google / Facebook said, only in their own words).
 */
export function tryResultPage({ provider, ok, person = null, reason = null, detail = null }) {
  const name = NAMES[provider] ?? "Sign-in";
  const back = `<p class="doc-actions"><a class="doc-btn" href="/30da/admin/connections">Back to the Code page</a></p>`;
  if (ok) {
    const who = person?.name || "a person with no name";
    const mailPart = person?.email ? ` (${esc(person.email)})` : " (no email shared)";
    return page({
      title: `${name} keys work · 30+DA`,
      robots: "noindex",
      kind: "try",
      body: `      <p class="try-verdict ok"><span class="try-mark" aria-hidden="true">✓</span> Works</p>
      <h1>${esc(name)} said: ${esc(who)}${mailPart}</h1>
      <p>Your ${WORKS_KEYS[provider] ?? "keys"} and the redirect address work.</p>
      <p class="try-note"><b>${ONLY_YOU[provider] ?? ""}</b> ${OPEN_TO_ALL[provider] ?? ""}</p>
      <p class="doc-fine">This was only a test: no profile was made and nobody was signed in. You can close this tab.</p>
${back}`,
    });
  }
  const [what, todo] = tryFailure(provider, reason);
  return page({
    title: `${name} sign-in did not work · 30+DA`,
    robots: "noindex",
    kind: "try",
    body: `      <p class="try-verdict bad"><span class="try-mark" aria-hidden="true">✗</span> Did not work</p>
      <h1>${what}</h1>
      <p>${todo}</p>
      ${detail ? `<p class="doc-fine">${esc(name)} said: ${esc(detail)}</p>` : ""}
      <p class="doc-fine">Nothing was saved: no profile was made and nobody was signed in.</p>
${back}`,
  });
}
