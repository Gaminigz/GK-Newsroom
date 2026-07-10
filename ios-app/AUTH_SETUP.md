# Login setup — what Gamini provides per provider

The server backend is built (`signInIdentity` + `/app/auth/*` routes in
`src/lib/app.mjs`). It reads all credentials from **Railway env vars** (set in
the Railway dashboard → web service → Variables; secrets never go in git/chat).
Native Capacitor plugins are wired per provider as each set of IDs arrives.

Bundle id everywhere: **`sg.ggmt.una5aha`**

---

## 1. Sign in with Apple  (required once any social login exists)
You have the Apple Developer account. Do:
1. developer.apple.com → Certificates, IDs & Profiles → **Identifiers** → your
   App ID `sg.ggmt.una5aha` → tick **Sign in with Apple** → Save.
That's all for native iOS. I enable the capability in Xcode (you approve the
prompt). Server verifies Apple's id_token against Apple's public keys — no
secret needed.
**Give me:** nothing to paste — just confirm step 1 is done.

## 2. Google
1. console.cloud.google.com → your project → **APIs & Services → Credentials**.
2. **Create Credentials → OAuth client ID → iOS** → Bundle ID
   `sg.ggmt.una5aha`. Copy the **iOS client ID** and the **iOS URL scheme**
   (the reversed client id, `com.googleusercontent.apps.…`).
3. **Create Credentials → OAuth client ID → Web application** → copy the
   **Web client ID** (used to validate the token audience).
**Give me:** iOS client ID · iOS URL scheme · Web client ID.
(These are public identifiers, safe to share. No secret needed for id_token flow.)
→ I set env var `GOOGLE_WEB_CLIENT_ID` and add the URL scheme to Info.plist.

## 3. Facebook  (has a Meta review gate — slowest)
1. developers.facebook.com → **Create App** → type **Consumer**.
2. Add product **Facebook Login** → Settings → add iOS platform, bundle
   `sg.ggmt.una5aha`.
3. App Dashboard → Settings → Basic → copy **App ID** and **Client Token**.
4. To go public: complete **App Review** for the `email` + `public_profile`
   permissions (dev mode works for you + listed testers meanwhile).
**Give me:** App ID (public) · Client Token → I set env var `FB_CLIENT_TOKEN`,
add App ID + URL scheme to Info.plist.
**Note:** submission can proceed while FB is in dev/review; it just isn't live
for the public until Meta approves.

## 4. SMS  (Twilio Verify — costs money)
1. twilio.com → create account (needs a card; ~$0.05 per verification).
2. Console → **Verify → Services → Create** → name it "3una 5aha" → copy the
   **Verify Service SID** (starts `VA…`).
3. Console home → copy **Account SID** (`AC…`) and **Auth Token** (secret).
**Give me:** set three Railway env vars yourself (Auth Token is a secret):
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SID`.
I'll guide you through the Railway Variables screen.

---

## Order I recommend
Apple → Google first (fast, your accounts only, unblocks iOS submission).
Facebook + SMS in parallel — they gate on Meta review / Twilio funding but
don't block the others. The welcome screen shows each button only once its
provider is wired, so there are never dead buttons at any stage.

## Where secrets live
Railway dashboard → project gk-newsroom → **web** service → Variables. Add
each var, Save → auto-redeploys. Public client IDs you can paste to me; secrets
(Twilio Auth Token, FB Client Token) you set directly in Railway.
