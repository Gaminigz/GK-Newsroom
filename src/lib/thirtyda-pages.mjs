/**
 * 30+DA small pages, served by src/lib/thirtyda-app.mjs in the app's look (src/thirtyda-app/pages.css):
 *
 *   GET /30da/privacy        the privacy policy (Google, Facebook and TikTok ask for its address)
 *   GET /30da/delete-data    how to have your data deleted (Facebook asks for its address)
 *   GET /30da/terms          the terms of service (TikTok asks for its address): 30+ only, honest, no contact
 *                            details, respect, we may remove accounts that break the rules, contact
 *   the admin's "Try sign-in" result (the end of GET /30da/api/auth/<provider>/callback for a test)
 *   GET /30da/back           where GKVerify's big "⬅️ Back to 30+DA" Telegram button lands (backPage): opens the app
 *                            on an iPhone / Android phone, else the web app
 *   GET /30da/home           the home page (homePage), laid out like the owner's template (ggmt.sg/newsfeed/3una5aha):
 *                            the phone-shaped card + sign-in pills, the store icons (App Store / Google Play coming
 *                            soon, Windows = the web app), the headline, the reminder, how it works in words, support &
 *                            contact, hashtags, SEO + JSON-LD; its own look in pages.css under .page-home (HOME_SLOTS)
 *
 * Short and sweet (owner 2026-10-13): a few plain one-line points, in the app's 5 languages, with the same small
 * flag row as the app's Me page at the top. The language: ?lang=en|km|zh|ko|ja, else the browser's
 * Accept-Language, else English (pickLang). The flags are plain links (no script: the page CSP allows none):
 * ?lang=… on the two public pages. The try page's address is single use (opening it again would start the
 * sign-in over), so it carries all 5 languages and its flags are #links that show one (pages.css, .tr).
 *
 * True to what the code does. Static text apart from the try page, where every value from Google / Facebook is
 * escaped. Pure: no database, no request.
 */
import { LANGS, LANG_NATIVE, LANG_FLAG } from "../thirtyda-app/shared/rules.js";
import { APP_SCHEME, APP_PACKAGE } from "./thirtyda-signin.mjs";

export const CONTACT_EMAIL = "gk.smart@ggmt.sg";
/** Who runs 30+DA (owner 2026-10-14): on every public page, next to the email. */
export const OPERATOR = "GGMT PTE. LTD.";
/** The day the privacy policy last changed (YYYY-MM-DD): the one place to change it. Each language writes it its own way (policyDate). */
export const POLICY_DATE = "2026-10-13";
/** The subject a deletion email asks for (English in every language: the team reads it; the mail link fills it in). */
export const DELETE_SUBJECT = "Delete my 30+DA account";
const NAMES = { google: "Google", facebook: "Facebook", tiktok: "TikTok" };
/** The two boxes of each sign-in card, by their labels on the (English) Code page and in Google / Meta / TikTok. */
const KEY_LABELS = { google: ["Client ID", "Client secret"], facebook: ["App ID", "App secret"], tiktok: ["Client key", "Client secret"] };

/** HTML-escape any text that did not come from this file. */
export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** "{name} did …" + { name } → the text. Values are HTML already (escaped by the caller when they are not ours). */
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

/**
 * The page language: ?lang= when it is one of the 5; else the first of the browser's Accept-Language (by its
 * q weights, then order) that is one of them, by base language (km-KH → km, zh-TW → zh); else English.
 */
export function pickLang(query, acceptLanguage) {
  const q = String(query ?? "").trim().toLowerCase();
  if (LANGS.includes(q)) return q;
  const prefs = String(acceptLanguage ?? "").slice(0, 512).split(",").map((part, i) => {
    const [tag, ...params] = part.trim().split(";");
    const qp = params.map((p) => p.trim().toLowerCase()).find((p) => p.startsWith("q="));
    const w = qp ? Number(qp.slice(2)) : 1;
    return { base: tag.trim().toLowerCase().split("-")[0], w: Number.isFinite(w) ? w : 0, i };
  }).filter((p) => p.base && p.w > 0).sort((a, b) => b.w - a.w || a.i - b.i);
  return prefs.find((p) => LANGS.includes(p.base))?.base ?? "en";
}

/** pickLang for a request: its ?lang= (when there is a URL) and its Accept-Language header. */
export function requestLang(req, url = null) {
  return pickLang(url?.searchParams?.get("lang"), req?.headers?.["accept-language"]);
}

/**
 * Every word on the three pages, in the app's 5 languages (same keys and {placeholders} in each — tested).
 * Names on the admin's Code page and in Google / Meta (Client ID, Redirect address, Publish app, Live) stay in
 * English inside the other languages, so the owner finds them where he has to press.
 */
export const PAGE_STRINGS = {
  en: {
    language: "Language",
    questions: "Questions:",
    run_by: "Run by",
    support_title: "Help & support",
    support_lede: "30+DA is a calm dating app for people aged 30 and over.",
    support_mail_k: "Email us:",
    support_mail: "write in any of the 5 languages.",
    support_delete_k: "Delete your account:",
    support_safety_k: "Report a problem:",
    support_safety: "email us. We check every report.",
    priv_title: "Privacy policy",
    priv_date: "Updated {date}",
    priv_lede: "30+DA is a dating app for people aged 30 and over.",
    priv_keep_k: "We keep:",
    priv_keep: "your profile, photos, phone number, rough area and messages.",
    priv_social_k: "From Google, Facebook or TikTok:",
    priv_social: "we keep only your account number and email.",
    priv_why_k: "Why:",
    priv_why: "to sign you in, show you people nearby and keep everyone safe.",
    priv_who_k: "Who sees it:",
    priv_who: "other members see your app name, photos and area. Your real name only once you both open the chat.",
    priv_team_k: "Our team:",
    priv_team: "only to check reports and keep the app safe.",
    priv_codes_k: "Telegram or WhatsApp:",
    priv_codes: "your number, only to send your code.",
    priv_never: "We never sell your data. No ads, no tracking.",
    priv_long_k: "How long:",
    priv_long: "until you delete your account.",
    priv_how_delete: "How to delete",
    kept_k: "What stays:",
    kept: "a bare note of any report and of the delete (no names or words), for safety, and your chat with our Telegram support bot.",
    del_title: "Delete your data",
    del_lede: "Two ways. Both delete your account and everything in it.",
    del_app_k: "In the app:",
    del_app: "My profile → Delete my account. It is instant.",
    del_mail_k: "Or by email:",
    del_step1: "Email {mail} with the subject {subject}.",
    del_step2: "Tell us your app name and how you sign in (phone, Google, Facebook or TikTok).",
    del_step3: "We delete it all and email you back — within 30 days.",
    del_signout: "Signing out does not delete anything.",
    back_app: "Back to 30+DA",
    try_title_ok: "{name} sign-in works",
    try_title_bad: "{name} sign-in did not work",
    try_works: "Works",
    try_failed: "Did not work",
    try_no_name: "no name",
    try_no_email: "no email shared",
    try_others_google: "Others can sign in once the app is published.",
    try_others_facebook: "Others can sign in once the app is Live.",
    try_back: "Back to the Code page",
    fix_cancelled: "Cancelled. Try again and pick your account.",
    fix_bad_keys: "{name} did not accept the {id} or {secret}. Copy them again.",
    fix_redirect: "Add the Redirect address from the Code page in {name}.",
    fix_not_live_google: "Press “Publish app” on Google’s consent screen, then try again.",
    fix_not_live_facebook: "Switch the app to Live in Meta, then try again.",
    fix_expired: "Took too long. Try again within 10 minutes, in this browser.",
    fix_timeout: "{name} did not answer. Wait a minute and try again.",
    fix_network: "We could not reach {name}. Wait a minute and try again.",
    fix_provider_error: "A problem on {name}’s side, not your keys. Wait a minute and try again.",
    fix_no_keys: "Save the {id} and {secret} on the Code page first.",
    fix_admin_gone: "Your admin sign-in ended. Sign in again, then try.",
    fix_too_many: "Too many tries. Wait 15 minutes.",
    fix_other: "{name} said no. Check the {id}, {secret} and Redirect address.",
    try_others_tiktok: "Others can sign in once TikTok approves the app.",
    fix_not_live_tiktok: "Submit the app for review in TikTok (with Login Kit), then try again.",
    terms_title: "Terms of service",
    terms_lede: "Using 30+DA means you agree to these few rules.",
    terms_age_k: "Age:",
    terms_age: "only for people aged 30 and over.",
    terms_honest_k: "Be honest:",
    terms_honest: "your own photos, your real age and your real name.",
    terms_contact_k: "No contact details:",
    terms_contact: "numbers, links and social accounts are stopped at every level.",
    terms_respect_k: "Respect:",
    terms_respect: "be kind. No insults, threats, spam or selling.",
    terms_team_k: "Our team:",
    terms_team: "may warn, block or remove accounts that break these rules.",
    terms_data_k: "Your data:",
    // The Android app's sign-in return page (appReturnPage).
    app_title: "Back to 30+DA",
    app_ok: "{name} sign-in done. Open 30+DA to finish.",
    app_bad: "Sign-in did not finish. Open 30+DA to go back.",
    app_open: "Open 30+DA",
    app_link: "Not opening? Use this link.",
    // GKVerify's back button page (backPage): the big button says app_open.
    back_lede: "If 30+DA did not open by itself, tap the big button.",
    back_web: "Open 30+DA in the browser",
    // The home page (homePage), laid out like the owner's template (ggmt.sg/newsfeed/3una5aha). home_tagline /
    // home_headline are the app's opening screen's own (op_tagline, op_headline); the levels follow the code
    // (src/thirtyda-app/shared/questions.js LEVEL_RULES: Level 2 = a few picked + a couple you write) told in words, no
    // numbers (owner 2026-10-14). home_soon / home_win: the store icons' labels. In zh / ja a "|" marks where a line may
    // break (between phrases, never inside a word): the page turns it into <wbr>, and drops it from the title, the
    // description and the labels.
    home_tagline: "Safe and calm dating for 30+",
    home_headline: "Don’t make the same mistake again.",
    home_desc: "30+DA: safe and calm dating for people aged 30 and over in Phnom Penh. Get to know someone slowly, in your own language. Free.",
    home_place: "Phnom Penh",
    home_card: "Meet someone slowly, in your own language. Every message translated.",
    home_alt: "A woman on a rooftop above the city lights at dusk",
    home_signin: "Sign in",
    home_guest: "Guest",
    home_soon: "coming soon",
    home_win: "Windows PC — open 30+DA in your browser",
    home_line: "Somewhere in this city, someone is looking for you too.",
    home_lead: "Get to know them slowly, in your own language — calm, kind, and only for 30+.",
    home_remind_h: "Reminder",
    home_remind: "30+DA is free — there is nothing to pay. We never ask for money, bank or card details. Never send money to someone you met online.",
    home_how_h: "How it works",
    home_l1_h: "Say hello",
    home_l1: "A few easy questions. One tap to answer.",
    home_l2_h: "Go deeper",
    home_l2: "Then a few more — a couple you write yourself. Another photo opens.",
    home_l3_h: "Chat",
    home_l3: "Every message translated into your language. Real names, at last.",
    home_verify: "Look around freely. Verify your number only when you want to chat.",
    home_contact_h: "Support & Contact",
    home_string: "They say an invisible red string ties you to someone.",
    home_frame_2: "A city full of strangers.",
    home_frame_3: "One face comes into focus.",
    home_frame_4: "This time, don’t walk past.",
    home_terms: "Terms",
    home_help: "Help",
  },
  km: {
    language: "ភាសា",
    questions: "សំណួរ៖",
    run_by: "ដំណើរការដោយ",
    support_title: "ជំនួយ និងការគាំទ្រ",
    support_lede: "30+DA គឺជាកម្មវិធីស្វែងរកដៃគូដ៏ស្ងប់ស្ងាត់ សម្រាប់អ្នកដែលមានអាយុ 30 ឆ្នាំឡើងទៅ។",
    support_mail_k: "អ៊ីមែលមកយើង៖",
    support_mail: "សរសេរជាភាសាណាមួយក្នុងចំណោម 5 ភាសា។",
    support_delete_k: "លុបគណនីរបស់អ្នក៖",
    support_safety_k: "រាយការណ៍បញ្ហា៖",
    support_safety: "អ៊ីមែលមកយើង។ យើងពិនិត្យរាល់របាយការណ៍។",
    priv_title: "គោលការណ៍ឯកជនភាព",
    priv_date: "កែថ្មី {date}",
    priv_lede: "30+DA ជាកម្មវិធីណាត់ជួប សម្រាប់អ្នកដែលមានអាយុពី 30 ឆ្នាំឡើងទៅ។",
    priv_keep_k: "យើងរក្សាទុក៖",
    priv_keep: "ប្រវត្តិរូប រូបថត លេខទូរស័ព្ទ តំបន់ប្រហាក់ប្រហែល និងសាររបស់អ្នក។",
    priv_social_k: "ពី Google, Facebook ឬ TikTok៖",
    priv_social: "យើងរក្សាទុកតែលេខគណនី និងអ៊ីមែលរបស់អ្នកប៉ុណ្ណោះ។",
    priv_why_k: "ហេតុអ្វី៖",
    priv_why: "ដើម្បីឲ្យអ្នកចូលបាន បង្ហាញមនុស្សនៅជិតអ្នក និងរក្សាសុវត្ថិភាពគ្រប់គ្នា។",
    priv_who_k: "អ្នកណាឃើញ៖",
    priv_who: "សមាជិកផ្សេងទៀតឃើញឈ្មោះក្នុងកម្មវិធី រូបថត និងតំបន់របស់អ្នក។ ឈ្មោះពិត លុះត្រាតែអ្នកទាំងពីរបើកការជជែក។",
    priv_team_k: "ក្រុមការងាររបស់យើង៖",
    priv_team: "មើលតែដើម្បីពិនិត្យការរាយការណ៍ និងរក្សាសុវត្ថិភាព។",
    priv_codes_k: "Telegram ឬ WhatsApp៖",
    priv_codes: "ប្រើលេខរបស់អ្នក តែដើម្បីផ្ញើលេខកូដប៉ុណ្ណោះ។",
    priv_never: "យើងមិនលក់ទិន្នន័យរបស់អ្នកទេ។ គ្មានពាណិជ្ជកម្ម គ្មានការតាមដាន។",
    priv_long_k: "រយៈពេល៖",
    priv_long: "រហូតដល់អ្នកលុបគណនី។",
    priv_how_delete: "របៀបលុប",
    kept_k: "អ្វីដែលនៅសល់៖",
    kept: "មានតែកំណត់ត្រាខ្លីនៃការរាយការណ៍ និងនៃការលុប (គ្មានឈ្មោះ ឬពាក្យ) ដើម្បីសុវត្ថិភាព និងការជជែករបស់អ្នកជាមួយបូតជំនួយ Telegram របស់យើង។",
    del_title: "លុបទិន្នន័យរបស់អ្នក",
    del_lede: "មានពីរវិធី។ វិធីទាំងពីរលុបគណនីរបស់អ្នក និងអ្វីៗទាំងអស់នៅក្នុងនោះ។",
    del_app_k: "ក្នុងកម្មវិធី៖",
    del_app: "ប្រវត្តិរូបរបស់ខ្ញុំ → លុបគណនីរបស់ខ្ញុំ។ លុបភ្លាមៗ។",
    del_mail_k: "ឬតាមអ៊ីមែល៖",
    del_step1: "ផ្ញើអ៊ីមែលទៅ {mail} ដោយដាក់ចំណងជើង {subject}។",
    del_step2: "ប្រាប់ឈ្មោះក្នុងកម្មវិធី និងរបៀបដែលអ្នកចូល (ទូរស័ព្ទ Google, Facebook ឬ TikTok)។",
    del_step3: "យើងលុបទាំងអស់ ហើយផ្ញើអ៊ីមែលប្រាប់អ្នក ក្នុងរយៈពេល 30 ថ្ងៃ។",
    del_signout: "ការចាកចេញពីកម្មវិធី មិនលុបអ្វីទាំងអស់ទេ។",
    back_app: "ត្រឡប់ទៅ 30+DA",
    try_title_ok: "ការចូលតាម {name} ដំណើរការ",
    try_title_bad: "ការចូលតាម {name} មិនដំណើរការ",
    try_works: "ដំណើរការ",
    try_failed: "មិនដំណើរការ",
    try_no_name: "គ្មានឈ្មោះ",
    try_no_email: "គ្មានអ៊ីមែល",
    try_others_google: "អ្នកដទៃអាចចូលបាន ពេលកម្មវិធីត្រូវបាន Publish។",
    try_others_facebook: "អ្នកដទៃអាចចូលបាន ពេលកម្មវិធីប្ដូរទៅ Live។",
    try_back: "ត្រឡប់ទៅទំព័រ Code",
    fix_cancelled: "បានបោះបង់។ សូមសាកម្ដងទៀត ហើយជ្រើសរើសគណនីរបស់អ្នក។",
    fix_bad_keys: "{name} មិនទទួលយក {id} ឬ {secret} ទេ។ សូមចម្លងម្ដងទៀត។",
    fix_redirect: "សូមបន្ថែម Redirect address ពីទំព័រ Code ទៅក្នុង {name}។",
    fix_not_live_google: "សូមចុច “Publish app” ក្នុង Google រួចសាកម្ដងទៀត។",
    fix_not_live_facebook: "សូមប្ដូរកម្មវិធីទៅ Live ក្នុង Meta រួចសាកម្ដងទៀត។",
    fix_expired: "យូរពេក។ សូមសាកម្ដងទៀត ហើយបញ្ចប់ក្នុង 10 នាទី លើ browser ដដែល។",
    fix_timeout: "{name} មិនឆ្លើយតប។ សូមរង់ចាំ 1 នាទី រួចសាកម្ដងទៀត។",
    fix_network: "មិនអាចភ្ជាប់ទៅ {name} បានទេ។ សូមរង់ចាំ 1 នាទី រួចសាកម្ដងទៀត។",
    fix_provider_error: "បញ្ហានៅខាង {name} មិនមែនខាងអ្នកទេ។ សូមរង់ចាំ 1 នាទី រួចសាកម្ដងទៀត។",
    fix_no_keys: "សូមរក្សាទុក {id} និង {secret} នៅទំព័រ Code ជាមុនសិន។",
    fix_admin_gone: "ការចូល admin របស់អ្នកបានផុតកំណត់។ សូមចូលម្ដងទៀត រួចសាកម្ដងទៀត។",
    fix_too_many: "សាកច្រើនដងពេក។ សូមរង់ចាំ 15 នាទី។",
    fix_other: "{name} មិនអនុញ្ញាតទេ។ សូមពិនិត្យ {id} {secret} និង Redirect address។",
    try_others_tiktok: "អ្នកដទៃអាចចូលបាន ពេល TikTok អនុម័តកម្មវិធី។",
    fix_not_live_tiktok: "សូមដាក់កម្មវិធីឲ្យ TikTok ពិនិត្យ (មាន Login Kit) រួចសាកម្ដងទៀត។",
    terms_title: "លក្ខខណ្ឌប្រើប្រាស់",
    terms_lede: "ការប្រើ 30+DA មានន័យថា អ្នកយល់ព្រមនឹងច្បាប់ខ្លីៗទាំងនេះ។",
    terms_age_k: "អាយុ៖",
    terms_age: "សម្រាប់តែអ្នកដែលមានអាយុពី 30 ឆ្នាំឡើងទៅ។",
    terms_honest_k: "ស្មោះត្រង់៖",
    terms_honest: "រូបថតរបស់អ្នកផ្ទាល់ អាយុពិត និងឈ្មោះពិត។",
    terms_contact_k: "គ្មានព័ត៌មានទំនាក់ទំនង៖",
    terms_contact: "លេខទូរស័ព្ទ តំណភ្ជាប់ និងគណនីបណ្ដាញសង្គម ត្រូវបានរារាំងគ្រប់កម្រិត។",
    terms_respect_k: "ការគោរព៖",
    terms_respect: "សូមមានចិត្តល្អ។ គ្មានការជេរប្រមាថ ការគំរាមកំហែង សារឥតបានការ ឬការលក់ដូរ។",
    terms_team_k: "ក្រុមការងាររបស់យើង៖",
    terms_team: "អាចព្រមាន បិទ ឬលុបគណនីដែលបំពានច្បាប់ទាំងនេះ។",
    terms_data_k: "ទិន្នន័យរបស់អ្នក៖",
    // The Android app's sign-in return page (appReturnPage).
    app_title: "ត្រឡប់ទៅ 30+DA",
    app_ok: "ការចូលតាម {name} រួចរាល់។ បើក 30+DA ដើម្បីបញ្ចប់។",
    app_bad: "ការចូលមិនទាន់បានបញ្ចប់ទេ។ បើក 30+DA ដើម្បីត្រឡប់ទៅវិញ។",
    app_open: "បើក 30+DA",
    app_link: "មិនបើកទេ? ប្រើតំណនេះ។",
    // GKVerify's back button page (backPage): the big button says app_open.
    back_lede: "បើ 30+DA មិនបើកដោយខ្លួនឯងទេ សូមចុចប៊ូតុងធំ។",
    back_web: "បើក 30+DA នៅក្នុង browser",
    // The home page (homePage).
    home_tagline: "ការណាត់ជួបប្រកបដោយសុវត្ថិភាព និងភាពស្ងប់ស្ងាត់ សម្រាប់វ័យ 30+",
    home_headline: "កុំធ្វើខុសដដែលម្ដងទៀត។",
    home_desc: "30+DA៖ ការណាត់ជួបប្រកបដោយសុវត្ថិភាព និងភាពស្ងប់ស្ងាត់ សម្រាប់អ្នកដែលមានអាយុពី 30 ឆ្នាំឡើងទៅ នៅភ្នំពេញ។ ស្គាល់គ្នាបន្តិចម្ដងៗ ជាភាសារបស់អ្នក។ ឥតគិតថ្លៃ។",
    home_place: "ភ្នំពេញ",
    home_card: "ស្គាល់នរណាម្នាក់បន្តិចម្ដងៗ ជាភាសារបស់អ្នក។ សារនីមួយៗត្រូវបានបកប្រែ។",
    home_alt: "នារីម្នាក់នៅលើដំបូលអគារ ពីលើពន្លឺភ្លើងទីក្រុងពេលព្រលប់",
    home_signin: "ចូលគណនី",
    home_guest: "ភ្ញៀវ",
    home_soon: "ឆាប់ៗនេះ",
    home_win: "កុំព្យូទ័រ Windows — បើក 30+DA ក្នុងកម្មវិធីរុករក",
    home_line: "នៅកន្លែងណាមួយក្នុងទីក្រុងនេះ មាននរណាម្នាក់កំពុងស្វែងរកអ្នកដែរ។",
    home_lead: "ស្គាល់គ្នាបន្តិចម្ដងៗ ជាភាសារបស់អ្នក — ស្ងប់ស្ងាត់ សុភាព និងសម្រាប់តែវ័យ 30+។",
    home_remind_h: "ការរំលឹក",
    home_remind: "30+DA ឥតគិតថ្លៃ — គ្មានអ្វីត្រូវបង់ទេ។ យើងមិនដែលសុំលុយ ព័ត៌មានធនាគារ ឬកាតឡើយ។ កុំផ្ញើលុយទៅអ្នកដែលអ្នកស្គាល់តាមអនឡាញ។",
    home_how_h: "របៀបប្រើ",
    home_l1_h: "និយាយសួស្ដី",
    home_l1: "សំណួរងាយៗមួយចំនួន។ ចុចតែម្ដងដើម្បីឆ្លើយ។",
    home_l2_h: "ស្គាល់គ្នាឲ្យជ្រៅជាងនេះ",
    home_l2: "បន្ទាប់មក សំណួរមួយចំនួនទៀត ខ្លះអ្នកសរសេរដោយខ្លួនឯង។ រូបថតមួយទៀតបើក។",
    home_l3_h: "ជជែក",
    home_l3: "សារនីមួយៗត្រូវបានបកប្រែជាភាសារបស់អ្នក។ ទីបំផុត ឃើញឈ្មោះពិត។",
    home_verify: "មើលដោយសេរី។ ផ្ទៀងផ្ទាត់លេខទូរស័ព្ទរបស់អ្នក តែពេលអ្នកចង់ជជែកប៉ុណ្ណោះ។",
    home_contact_h: "ជំនួយ និងទំនាក់ទំនង",
    home_string: "គេថា មានខ្សែក្រហមមួយដែលមើលមិនឃើញ ចងអ្នកជាប់នឹងនរណាម្នាក់។",
    home_frame_2: "ទីក្រុងដែលពោរពេញដោយមនុស្សមិនស្គាល់គ្នា។",
    home_frame_3: "មុខមួយស្រាប់តែច្បាស់ឡើង។",
    home_frame_4: "លើកនេះ កុំដើរហួសគ្នាទៀត។",
    home_terms: "លក្ខខណ្ឌប្រើប្រាស់",
    home_help: "ជំនួយ",
  },
  zh: {
    language: "语言",
    questions: "联系我们：",
    run_by: "运营方：",
    support_title: "帮助与支持",
    support_lede: "30+DA 是一款为 30 岁及以上人士打造的安心交友应用。",
    support_mail_k: "发邮件给我们：",
    support_mail: "5 种语言都可以。",
    support_delete_k: "删除账户：",
    support_safety_k: "举报问题：",
    support_safety: "发邮件给我们。每一份举报我们都会查看。",
    priv_title: "隐私政策",
    priv_date: "更新于 {date}",
    priv_lede: "30+DA 是为 30 岁及以上人士打造的交友应用。",
    priv_keep_k: "我们保存：",
    priv_keep: "你的资料、照片、手机号、大致位置和消息。",
    priv_social_k: "来自 Google、Facebook 或 TikTok：",
    priv_social: "我们只保存你的账号编号和邮箱。",
    priv_why_k: "用途：",
    priv_why: "让你登录、为你显示附近的人，并保障大家的安全。",
    priv_who_k: "谁能看到：",
    priv_who: "其他会员能看到你的昵称、照片和所在区域。真实姓名要等你们都打开聊天后才显示。",
    priv_team_k: "我们的团队：",
    priv_team: "只为处理举报、保障安全而查看。",
    priv_codes_k: "Telegram 或 WhatsApp：",
    priv_codes: "只用你的号码发送验证码。",
    priv_never: "我们绝不出售你的数据。没有广告，没有追踪。",
    priv_long_k: "保存多久：",
    priv_long: "直到你删除账号。",
    priv_how_delete: "如何删除",
    kept_k: "保留的内容：",
    kept: "为了安全，只保留举报和删除的简短记录（不含姓名或文字），以及你和我们 Telegram 客服机器人的对话。",
    del_title: "删除你的数据",
    del_lede: "两种方式，都会删除你的账号及其中的一切。",
    del_app_k: "在应用里：",
    del_app: "我的资料 → 删除我的账号。立即删除。",
    del_mail_k: "或发邮件：",
    del_step1: "发邮件到 {mail}，标题写 {subject}。",
    del_step2: "告诉我们你的昵称和登录方式（手机、Google、Facebook 或 TikTok）。",
    del_step3: "我们会全部删除并回邮件告诉你，30 天内完成。",
    del_signout: "退出登录不会删除任何数据。",
    back_app: "返回 30+DA",
    try_title_ok: "{name} 登录成功",
    try_title_bad: "{name} 登录未成功",
    try_works: "成功",
    try_failed: "未成功",
    try_no_name: "无名字",
    try_no_email: "未提供邮箱",
    try_others_google: "应用发布（Publish）后，其他人也能登录。",
    try_others_facebook: "应用切换到 Live 后，其他人也能登录。",
    try_back: "返回 Code 页面",
    fix_cancelled: "已取消。请再试一次，并选择你的账号。",
    fix_bad_keys: "{name} 不接受这个 {id} 或 {secret}。请重新复制。",
    fix_redirect: "请把 Code 页面上的 Redirect address 添加到 {name}。",
    fix_not_live_google: "请在 Google 同意屏幕上点击 “Publish app”，然后再试。",
    fix_not_live_facebook: "请在 Meta 把应用切换到 Live，然后再试。",
    fix_expired: "时间太长了。请用同一个浏览器，在 10 分钟内再试一次。",
    fix_timeout: "{name} 没有回应。请过一分钟再试。",
    fix_network: "连不上 {name}。请过一分钟再试。",
    fix_provider_error: "是 {name} 那边的问题，不是你的设置。请过一分钟再试。",
    fix_no_keys: "请先在 Code 页面保存 {id} 和 {secret}。",
    fix_admin_gone: "你的管理员登录已过期。请重新登录后再试。",
    fix_too_many: "尝试次数太多。请等 15 分钟。",
    fix_other: "{name} 拒绝了登录。请检查 {id}、{secret} 和 Redirect address。",
    try_others_tiktok: "TikTok 审核通过应用后，其他人也能登录。",
    fix_not_live_tiktok: "请在 TikTok 添加 Login Kit 并提交应用审核，然后再试。",
    terms_title: "服务条款",
    terms_lede: "使用 30+DA，即表示你同意以下几条规则。",
    terms_age_k: "年龄：",
    terms_age: "仅限 30 岁及以上人士。",
    terms_honest_k: "诚实：",
    terms_honest: "用你自己的照片、真实年龄和真实姓名。",
    terms_contact_k: "不留联系方式：",
    terms_contact: "号码、链接和社交账号在每个级别都会被拦截。",
    terms_respect_k: "尊重：",
    terms_respect: "友善待人。禁止辱骂、威胁、垃圾信息和推销。",
    terms_team_k: "我们的团队：",
    terms_team: "可对违反规则的账号发出警告、封禁或删除。",
    terms_data_k: "你的数据：",
    // The Android app's sign-in return page (appReturnPage).
    app_title: "返回 30+DA",
    app_ok: "{name} 登录已完成。打开 30+DA 即可完成。",
    app_bad: "登录未完成。打开 30+DA 返回。",
    app_open: "打开 30+DA",
    app_link: "没有打开？请使用此链接。",
    // GKVerify's back button page (backPage): the big button says app_open.
    back_lede: "如果 30+DA 没有自动打开，请点大按钮。",
    back_web: "在浏览器中打开 30+DA",
    // The home page (homePage). "|" = where a line may break (between phrases).
    home_tagline: "30+ 的安全、从容交友",
    home_headline: "别再犯|同样的错误。",
    home_desc: "30+DA：为金边 30 岁及以上人士打造的安全、从容的交友应用。用你自己的语言，慢慢认识一个人。免费。",
    home_place: "金边",
    home_card: "用你自己的语言，|慢慢|认识一个人。|每条消息|都会翻译。",
    home_alt: "黄昏时分，屋顶上的女子望着城市灯火",
    home_signin: "登录",
    home_guest: "游客",
    home_soon: "即将上线",
    home_win: "Windows 电脑——在浏览器中打开 30+DA",
    home_line: "在这座城市的|某个角落，|也有人|在找你。",
    home_lead: "用你自己的语言，|慢慢|认识对方——|从容、|友善，|只为 30+。",
    home_remind_h: "提醒",
    home_remind: "30+DA 完全免费——|没有任何|需要付钱的地方。|我们|绝不会|向你要钱、|银行或|银行卡信息。|永远不要|给网上|认识的人|汇钱。",
    home_how_h: "怎么用",
    home_l1_h: "打个招呼",
    home_l1: "几个|简单的问题，|点一下|就能回答。",
    home_l2_h: "再深入一点",
    home_l2: "接着|再来几个，|有的|由你|自己写。|还能|多看到|一张照片。",
    home_l3_h: "聊天",
    home_l3: "每条消息|都翻译成|你的语言。|终于，|看到真名。",
    home_verify: "随意看看。|只有在|想聊天的时候，|才需要|验证手机号。",
    home_contact_h: "支持与联系",
    home_string: "传说，|一根|看不见的红线，|把你|和某个人|系在一起。",
    home_frame_2: "满城|都是陌生人。",
    home_frame_3: "有一张脸，|忽然|清晰起来。",
    home_frame_4: "这一次，|别再|擦肩而过。",
    home_terms: "使用条款",
    home_help: "帮助",
  },
  ko: {
    language: "언어",
    questions: "문의:",
    run_by: "운영:",
    support_title: "도움말 및 지원",
    support_lede: "30+DA는 30세 이상을 위한 차분한 데이트 앱입니다.",
    support_mail_k: "이메일 문의:",
    support_mail: "5개 언어 중 어느 언어로든 쓰셔도 됩니다.",
    support_delete_k: "계정 삭제:",
    support_safety_k: "문제 신고:",
    support_safety: "이메일로 알려 주세요. 모든 신고를 확인합니다.",
    priv_title: "개인정보 처리방침",
    priv_date: "{date} 업데이트",
    priv_lede: "30+DA는 30세 이상을 위한 만남 앱이에요.",
    priv_keep_k: "보관하는 정보:",
    priv_keep: "프로필, 사진, 전화번호, 대략적인 지역, 메시지.",
    priv_social_k: "Google·Facebook·TikTok에서:",
    priv_social: "계정 번호와 이메일만 보관해요.",
    priv_why_k: "이유:",
    priv_why: "로그인, 근처 사람 보여 주기, 모두의 안전을 위해서예요.",
    priv_who_k: "누가 보나요:",
    priv_who: "다른 회원은 앱 이름, 사진, 지역을 봐요. 실명은 두 분 모두 채팅을 열었을 때만 보여요.",
    priv_team_k: "운영팀:",
    priv_team: "신고 확인과 안전을 위해서만 봐요.",
    priv_codes_k: "Telegram·WhatsApp:",
    priv_codes: "인증 코드를 보낼 때만 번호를 써요.",
    priv_never: "데이터를 절대 팔지 않아요. 광고도, 추적도 없어요.",
    priv_long_k: "보관 기간:",
    priv_long: "계정을 삭제할 때까지.",
    priv_how_delete: "삭제 방법",
    kept_k: "남는 것:",
    kept: "안전을 위해 신고와 삭제에 대한 짧은 기록(이름이나 글 없음)과 Telegram 고객지원 봇과의 대화만 남아요.",
    del_title: "내 데이터 삭제",
    del_lede: "두 가지 방법이 있어요. 둘 다 계정과 그 안의 모든 것을 삭제해요.",
    del_app_k: "앱에서:",
    del_app: "내 프로필 → 내 계정 삭제. 바로 삭제돼요.",
    del_mail_k: "또는 메일로:",
    del_step1: "{mail}로 메일을 보내 주세요. 제목: {subject}",
    del_step2: "앱 이름과 로그인 방법(전화번호, Google, Facebook, TikTok)을 알려 주세요.",
    del_step3: "30일 안에 모두 삭제하고 메일로 알려 드려요.",
    del_signout: "로그아웃만으로는 아무것도 삭제되지 않아요.",
    back_app: "30+DA로 돌아가기",
    try_title_ok: "{name} 로그인 성공",
    try_title_bad: "{name} 로그인 실패",
    try_works: "성공",
    try_failed: "실패",
    try_no_name: "이름 없음",
    try_no_email: "이메일 없음",
    try_others_google: "앱을 게시(Publish)하면 다른 사람도 로그인할 수 있어요.",
    try_others_facebook: "앱을 Live로 바꾸면 다른 사람도 로그인할 수 있어요.",
    try_back: "Code 페이지로 돌아가기",
    fix_cancelled: "취소됐어요. 다시 시도해서 계정을 선택하세요.",
    fix_bad_keys: "{name}에서 {id} 또는 {secret}을 받지 않았어요. 다시 복사하세요.",
    fix_redirect: "Code 페이지의 Redirect address를 {name}에 추가하세요.",
    fix_not_live_google: "Google 동의 화면에서 “Publish app”을 누른 뒤 다시 시도하세요.",
    fix_not_live_facebook: "Meta에서 앱을 Live로 바꾼 뒤 다시 시도하세요.",
    fix_expired: "시간이 너무 걸렸어요. 같은 브라우저에서 10분 안에 다시 시도하세요.",
    fix_timeout: "{name}에서 응답이 없어요. 1분 뒤 다시 시도하세요.",
    fix_network: "{name}에 연결할 수 없어요. 1분 뒤 다시 시도하세요.",
    fix_provider_error: "{name} 쪽 문제예요. 설정은 괜찮아요. 1분 뒤 다시 시도하세요.",
    fix_no_keys: "먼저 Code 페이지에 {id}와 {secret}을 저장하세요.",
    fix_admin_gone: "관리자 로그인이 끝났어요. 다시 로그인한 뒤 시도하세요.",
    fix_too_many: "시도가 너무 많아요. 15분 기다려 주세요.",
    fix_other: "{name}에서 로그인을 거부했어요. {id}, {secret}, Redirect address를 확인하세요.",
    try_others_tiktok: "TikTok이 앱을 승인하면 다른 사람도 로그인할 수 있어요.",
    fix_not_live_tiktok: "TikTok에서 Login Kit을 추가하고 앱 심사를 제출한 뒤 다시 시도하세요.",
    terms_title: "서비스 약관",
    terms_lede: "30+DA를 사용하면 아래 몇 가지 규칙에 동의하는 거예요.",
    terms_age_k: "나이:",
    terms_age: "30세 이상만 이용할 수 있어요.",
    terms_honest_k: "정직:",
    terms_honest: "본인 사진, 실제 나이, 실명을 사용하세요.",
    terms_contact_k: "연락처 금지:",
    terms_contact: "전화번호, 링크, SNS 계정은 모든 단계에서 차단돼요.",
    terms_respect_k: "존중:",
    terms_respect: "친절하게 대해 주세요. 욕설, 협박, 스팸, 판매는 안 돼요.",
    terms_team_k: "운영팀:",
    terms_team: "규칙을 어긴 계정은 경고, 차단 또는 삭제할 수 있어요.",
    terms_data_k: "내 데이터:",
    // The Android app's sign-in return page (appReturnPage).
    app_title: "30+DA로 돌아가기",
    app_ok: "{name} 로그인이 끝났어요. 30+DA를 열어 마무리하세요.",
    app_bad: "로그인이 끝나지 않았어요. 30+DA를 열어 돌아가세요.",
    app_open: "30+DA 열기",
    app_link: "열리지 않나요? 이 링크를 쓰세요.",
    // GKVerify's back button page (backPage): the big button says app_open.
    back_lede: "30+DA가 저절로 열리지 않으면 큰 버튼을 누르세요.",
    back_web: "브라우저에서 30+DA 열기",
    // The home page (homePage).
    home_tagline: "30+를 위한 안전하고 차분한 만남",
    home_headline: "같은 실수를 반복하지 마세요.",
    home_desc: "30+DA: 프놈펜의 30세 이상을 위한 안전하고 차분한 데이트 앱. 내 언어로 천천히 알아 가요. 무료예요.",
    home_place: "프놈펜",
    home_card: "내 언어로, 천천히 누군가를 알아 가요. 모든 메시지가 번역돼요.",
    home_alt: "해 질 녘 옥상에서 도시의 불빛을 바라보는 여자",
    home_signin: "로그인",
    home_guest: "게스트",
    home_soon: "출시 예정",
    home_win: "Windows PC — 브라우저에서 30+DA 열기",
    home_line: "이 도시 어딘가에서, 누군가도 당신을 찾고 있어요.",
    home_lead: "내 언어로 천천히 알아 가요 — 차분하고 다정한, 30+만을 위한 곳.",
    home_remind_h: "주의",
    home_remind: "30+DA는 무료예요 — 결제할 것이 없어요. 돈, 은행이나 카드 정보를 절대 묻지 않아요. 온라인에서 만난 사람에게 절대 돈을 보내지 마세요.",
    home_how_h: "이용 방법",
    home_l1_h: "인사하기",
    home_l1: "쉬운 질문 몇 가지. 한 번 눌러 답해요.",
    home_l2_h: "조금 더 깊이",
    home_l2: "이어서 몇 가지 더, 그중 몇 개는 직접 써요. 사진이 한 장 더 열려요.",
    home_l3_h: "채팅",
    home_l3: "모든 메시지가 내 언어로 번역돼요. 드디어 실명도요.",
    home_verify: "자유롭게 둘러보세요. 전화번호 인증은 채팅하고 싶을 때만 해요.",
    home_contact_h: "지원 및 문의",
    home_string: "보이지 않는 붉은 실이 당신과 누군가를 이어 준대요.",
    home_frame_2: "낯선 사람들로 가득한 도시.",
    home_frame_3: "한 얼굴이 또렷해져요.",
    home_frame_4: "이번에는 스쳐 지나가지 마세요.",
    home_terms: "이용약관",
    home_help: "도움말",
  },
  ja: {
    language: "言語",
    questions: "お問い合わせ：",
    run_by: "運営：",
    support_title: "ヘルプとサポート",
    support_lede: "30+DA は 30 歳以上の方のための落ち着いた出会いアプリです。",
    support_mail_k: "メールでのお問い合わせ：",
    support_mail: "5 つの言語のどれで書いても大丈夫です。",
    support_delete_k: "アカウント削除：",
    support_safety_k: "問題の報告：",
    support_safety: "メールでお知らせください。すべての報告を確認します。",
    priv_title: "プライバシーポリシー",
    priv_date: "{date} 更新",
    priv_lede: "30+DA は、30歳以上の方のための出会いアプリです。",
    priv_keep_k: "保存するもの：",
    priv_keep: "プロフィール、写真、電話番号、おおよその地域、メッセージ。",
    priv_social_k: "Google・Facebook・TikTok から：",
    priv_social: "アカウント番号とメールアドレスだけを保存します。",
    priv_why_k: "目的：",
    priv_why: "ログイン、近くの人の表示、みんなの安全のため。",
    priv_who_k: "見える人：",
    priv_who: "他の会員には、アプリ名・写真・地域が見えます。本名は、お互いにチャットを開いたときだけ。",
    priv_team_k: "運営チーム：",
    priv_team: "報告の確認と安全のためだけに見ます。",
    priv_codes_k: "Telegram・WhatsApp：",
    priv_codes: "コードを送るためだけに番号を使います。",
    priv_never: "データは売りません。広告も追跡もありません。",
    priv_long_k: "保存期間：",
    priv_long: "アカウントを削除するまで。",
    priv_how_delete: "削除のしかた",
    kept_k: "残るもの：",
    kept: "安全のため、通報と削除の簡単な記録（名前や文章は含みません）と、Telegramサポートボットとのやりとりだけです。",
    del_title: "データの削除",
    del_lede: "方法は2つ。どちらもアカウントとその中のすべてを削除します。",
    del_app_k: "アプリで：",
    del_app: "マイプロフィール → アカウントを削除。すぐに削除されます。",
    del_mail_k: "またはメールで：",
    del_step1: "{mail} に、件名 {subject} でメールしてください。",
    del_step2: "アプリ名とログイン方法（電話番号・Google・Facebook・TikTok）を書いてください。",
    del_step3: "30日以内にすべて削除し、メールでお知らせします。",
    del_signout: "ログアウトしても、何も削除されません。",
    back_app: "30+DA に戻る",
    try_title_ok: "{name} ログイン成功",
    try_title_bad: "{name} ログイン失敗",
    try_works: "成功",
    try_failed: "失敗",
    try_no_name: "名前なし",
    try_no_email: "メールなし",
    try_others_google: "アプリを公開（Publish）すると、他の人もログインできます。",
    try_others_facebook: "アプリを Live にすると、他の人もログインできます。",
    try_back: "Code ページに戻る",
    fix_cancelled: "キャンセルされました。もう一度試して、アカウントを選んでください。",
    fix_bad_keys: "{name} が {id} または {secret} を受け付けませんでした。もう一度コピーしてください。",
    fix_redirect: "Code ページの Redirect address を {name} に追加してください。",
    fix_not_live_google: "Google の同意画面で「Publish app」を押してから、もう一度試してください。",
    fix_not_live_facebook: "Meta でアプリを Live にしてから、もう一度試してください。",
    fix_expired: "時間がかかりすぎました。同じブラウザで、10分以内にもう一度試してください。",
    fix_timeout: "{name} から応答がありません。1分待ってから、もう一度試してください。",
    fix_network: "{name} につながりません。1分待ってから、もう一度試してください。",
    fix_provider_error: "{name} 側の問題で、設定のせいではありません。1分待ってから、もう一度試してください。",
    fix_no_keys: "先に Code ページで {id} と {secret} を保存してください。",
    fix_admin_gone: "管理者ログインが切れました。もう一度ログインしてから試してください。",
    fix_too_many: "試行回数が多すぎます。15分待ってください。",
    fix_other: "{name} がログインを拒否しました。{id}・{secret}・Redirect address を確認してください。",
    try_others_tiktok: "TikTok がアプリを承認すると、他の人もログインできます。",
    fix_not_live_tiktok: "TikTok で Login Kit を追加してアプリを審査に出してから、もう一度試してください。",
    terms_title: "利用規約",
    terms_lede: "30+DA を使うと、次のいくつかのルールに同意したことになります。",
    terms_age_k: "年齢：",
    terms_age: "30歳以上の方のみ。",
    terms_honest_k: "正直に：",
    terms_honest: "ご本人の写真、本当の年齢、本名を使ってください。",
    terms_contact_k: "連絡先は禁止：",
    terms_contact: "電話番号・リンク・SNS アカウントは、どの段階でも止められます。",
    terms_respect_k: "思いやり：",
    terms_respect: "親切に。暴言・脅し・スパム・販売は禁止です。",
    terms_team_k: "運営チーム：",
    terms_team: "ルールに違反したアカウントは、警告・ブロック・削除することがあります。",
    terms_data_k: "あなたのデータ：",
    // The Android app's sign-in return page (appReturnPage).
    app_title: "30+DA に戻る",
    app_ok: "{name} でのログインが済みました。30+DA を開いて完了してください。",
    app_bad: "ログインは完了していません。30+DA を開いて戻ってください。",
    app_open: "30+DA を開く",
    app_link: "開かない場合は、このリンクを使ってください。",
    // GKVerify's back button page (backPage): the big button says app_open.
    back_lede: "30+DA が自動で開かない場合は、大きなボタンを押してください。",
    back_web: "ブラウザで 30+DA を開く",
    // The home page (homePage). "|" = where a line may break (between phrases).
    home_tagline: "30+のための、安心で穏やかな出会い",
    home_headline: "同じ過ちを、|もう|繰り返さない。",
    home_desc: "30+DA：プノンペンの30歳以上の方のための、安心で穏やかな出会いアプリ。自分の言葉で、ゆっくり知り合えます。無料です。",
    home_place: "プノンペン",
    home_card: "自分の言葉で、|ゆっくり|知り合えます。|メッセージは|すべて翻訳。",
    home_alt: "夕暮れの屋上から街の灯りを見つめる女性",
    home_signin: "ログイン",
    home_guest: "ゲスト",
    home_soon: "近日公開",
    home_win: "Windows PC — ブラウザで 30+DA を開く",
    home_line: "この街の|どこかで、|誰かも|あなたを|探しています。",
    home_lead: "自分の言葉で、|ゆっくり|知り合える。|穏やかで|やさしい、|30+だけの|場所です。",
    home_remind_h: "ご注意",
    home_remind: "30+DAは|無料です。|お支払いは|一切|ありません。|お金や|銀行・カードの|情報を|求めることは|決して|ありません。|ネットで|知り合った人に|お金を|送らないでください。",
    home_how_h: "使い方",
    home_l1_h: "あいさつ",
    home_l1: "かんたんな|質問を|いくつか。|答えは|ワンタップ。",
    home_l2_h: "もう少し深く",
    home_l2: "続けて|もういくつか。|そのうち|いくつかは|自分で書く質問。|写真が|もう一枚|見られます。",
    home_l3_h: "チャット",
    home_l3: "メッセージは|すべて|あなたの言語に|翻訳。|やっと|本名も。",
    home_verify: "自由に|見てまわって。|電話番号の|確認は、|チャットしたい|ときだけ。",
    home_contact_h: "サポート・|お問い合わせ",
    home_string: "見えない|赤い糸が、|あなたと|誰かを|結んでいると|いいます。",
    home_frame_2: "見知らぬ人で|あふれる街。",
    home_frame_3: "ひとつの顔に、|ふと|ピントが合う。",
    home_frame_4: "今度こそ、|すれ違わないで。",
    home_terms: "利用規約",
    home_help: "ヘルプ",
  },
};

const ok = (lang) => (LANGS.includes(lang) ? lang : "en");

const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const KM_MONTHS = ["មករា", "កុម្ភៈ", "មីនា", "មេសា", "ឧសភា", "មិថុនា", "កក្កដា", "សីហា", "កញ្ញា", "តុលា", "វិច្ឆិកា", "ធ្នូ"];
/** POLICY_DATE (or any YYYY-MM-DD) as each language writes it: 13 Oct 2026 · 13 តុលា 2026 · 2026 年 10 月 13 日 · 2026년 10월 13일 · 2026年10月13日. */
export function policyDate(lang, iso = POLICY_DATE) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return {
    en: `${d} ${EN_MONTHS[m - 1]} ${y}`,
    km: `${d} ${KM_MONTHS[m - 1]} ${y}`,
    zh: `${y} 年 ${m} 月 ${d} 日`,
    ko: `${y}년 ${m}월 ${d}일`,
    ja: `${y}年${m}月${d}日`,
  }[ok(lang)];
}

const mailLink = `<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>`;
const supportMailLink = `<a href="mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("30+DA support")}">${CONTACT_EMAIL}</a>`;
const deleteMailLink = `<a href="mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(DELETE_SUBJECT)}">${CONTACT_EMAIL}</a>`;

/** The small flag row (the app's Me page look): flag + short native name, the current one filled navy. */
function flagRow(lang, hrefFor) {
  const links = LANGS.map((code) => `<a href="${hrefFor(code)}" hreflang="${code}" lang="${code}"${code === lang ? ' aria-current="true"' : ""}>`
    + `<span class="flag" aria-hidden="true">${LANG_FLAG[code]}</span>${LANG_NATIVE[code]}</a>`).join("");
  return `<nav class="langs" aria-label="${PAGE_STRINGS[lang].language}">${links}</nav>`;
}

/** One language's column: the navy wordmark band, the flags, the text. */
function docColumn({ lang, flags, body, tag = "main", attrs = "" }) {
  return `  <div class="doc"${attrs}>
    <header class="doc-bar"><a class="doc-mark" href="/30da/">30+DA</a></header>
    ${flags}
    <${tag} class="doc-body">
${body}
    </${tag}>
  </div>`;
}

function page({ title, lang, inner, robots = "index", kind = "doc", script = null, description = null, head = "" }) {
  // A description (the home page): the search result's line and the card a shared link shows (Telegram, Facebook);
  // `head`: more of the home page's <head> (keywords, canonical, the share picture, JSON-LD — homeHead).
  const about = description ? `
  <meta name="description" content="${esc(description)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="30+DA">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">` : "";
  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#0b1c3f">
  <meta name="robots" content="${robots}">${about}${head}
  <title>${esc(title)}</title>
  <link rel="icon" href="data:,">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,400..900&family=JetBrains+Mono:wght@400..600&display=swap">
  <link rel="stylesheet" href="/30da/pages.css">${script ? `\n  <script src="${script}" defer></script>` : ""}
</head>
<body class="page-${kind}">
${inner}
</body>
</html>
`;
}

/**
 * "Back to 30+DA": the app opens these pages in its own tab (#/me and the opening screen link here), and an app's web
 * view has no back button — this goes back to #/me (the opening screen for someone not signed in).
 */
const backToApp = (t) => `      <p class="doc-actions"><a class="doc-btn" href="/30da/#/me">${t.back_app}</a></p>`;

/** GET /30da/privacy[?lang=] — what Google and Facebook ask for, one plain line each. */
export function privacyPage({ lang: want } = {}) {
  const lang = ok(want);
  const t = PAGE_STRINGS[lang];
  const point = (k) => `        <li><b>${t[`${k}_k`]}</b> ${t[k]}</li>`;
  const body = `      <h1>${t.priv_title}</h1>
      <p class="doc-date">${fill(t.priv_date, { date: policyDate(lang) })}</p>
      <p class="doc-lede">${t.priv_lede}</p>
      <ul class="facts">
${["priv_keep", "priv_social", "priv_why", "priv_who", "priv_team", "priv_codes"].map(point).join("\n")}
        <li>${t.priv_never}</li>
        <li><b>${t.priv_long_k}</b> ${t.priv_long} <a href="/30da/delete-data?lang=${lang}">${t.priv_how_delete}</a></li>
      </ul>
      <p class="doc-fine"><b>${t.kept_k}</b> ${t.kept}</p>
      <p class="doc-contact">${t.run_by} <b>${OPERATOR}</b> · ${t.questions} ${mailLink}</p>
${backToApp(t)}`;
  return page({
    title: `${t.priv_title} · 30+DA`,
    lang,
    inner: docColumn({ lang, flags: flagRow(lang, (c) => `/30da/privacy?lang=${c}`), body }),
  });
}

/**
 * GET /30da/delete-data[?lang=] — two ways, both delete the account and everything in it: in the app (My profile →
 * Delete my account, at once: src/lib/thirtyda-delete.mjs), or email us and we delete it all within 30 days. Says what
 * stays (Google Play asks): a bare note of reports / of the delete, for safety, and the Telegram support chat.
 */
export function deleteDataPage({ lang: want } = {}) {
  const lang = ok(want);
  const t = PAGE_STRINGS[lang];
  const mail = [fill(t.del_step1, { mail: deleteMailLink, subject: `<b>${DELETE_SUBJECT}</b>` }), t.del_step2, t.del_step3].join(" ");
  const body = `      <h1>${t.del_title}</h1>
      <p class="doc-lede">${t.del_lede}</p>
      <ul class="facts">
        <li><b>${t.del_app_k}</b> ${t.del_app}</li>
        <li><b>${t.del_mail_k}</b> ${mail}</li>
      </ul>
      <p class="doc-fine"><b>${t.kept_k}</b> ${t.kept}</p>
      <p class="doc-fine">${t.del_signout}</p>
      <p class="doc-contact">${t.run_by} <b>${OPERATOR}</b> · ${t.questions} ${mailLink} · <a href="/30da/privacy?lang=${lang}">${t.priv_title}</a></p>
${backToApp(t)}`;
  return page({
    title: `${t.del_title} · 30+DA`,
    lang,
    inner: docColumn({ lang, flags: flagRow(lang, (c) => `/30da/delete-data?lang=${c}`), body }),
  });
}

/**
 * GET /30da/terms[?lang=] — the few rules, true to what the app does: 30 and over only, honest profile, contact
 * details stopped at every level (src/thirtyda-app/shared/rules.js), respect, the team may warn / block / remove.
 */
export function termsPage({ lang: want } = {}) {
  const lang = ok(want);
  const t = PAGE_STRINGS[lang];
  const point = (k) => `        <li><b>${t[`${k}_k`]}</b> ${t[k]}</li>`;
  const body = `      <h1>${t.terms_title}</h1>
      <p class="doc-date">${fill(t.priv_date, { date: policyDate(lang) })}</p>
      <p class="doc-lede">${t.terms_lede}</p>
      <ul class="facts">
${["terms_age", "terms_honest", "terms_contact", "terms_respect", "terms_team"].map(point).join("\n")}
        <li><b>${t.terms_data_k}</b> <a href="/30da/privacy?lang=${lang}">${t.priv_title}</a></li>
      </ul>
      <p class="doc-contact">${t.run_by} <b>${OPERATOR}</b> · ${t.questions} ${mailLink}</p>
${backToApp(t)}`;
  return page({
    title: `${t.terms_title} · 30+DA`,
    lang,
    inner: docColumn({ lang, flags: flagRow(lang, (c) => `/30da/terms?lang=${c}`), body }),
  });
}

/**
 * GET /30da/support[?lang=] — Help & support (the App Store "Support URL"; owner 2026-10-14 "I don't see
 * gk.smart@ggmt.sg anywhere"): who runs 30+DA, the email, how to report, how to delete.
 */
export function supportPage({ lang: want } = {}) {
  const lang = ok(want);
  const t = PAGE_STRINGS[lang];
  const body = `      <h1>${t.support_title}</h1>
      <p class="doc-lede">${t.support_lede}</p>
      <ul class="facts">
        <li><b>${t.support_mail_k}</b> ${supportMailLink} — ${t.support_mail}</li>
        <li><b>${t.support_safety_k}</b> ${t.support_safety}</li>
        <li><b>${t.support_delete_k}</b> ${t.del_app} <a href="/30da/delete-data?lang=${lang}">${t.priv_how_delete}</a></li>
      </ul>
      <p class="doc-contact">${t.run_by} <b>${OPERATOR}</b> · <a href="/30da/privacy?lang=${lang}">${t.priv_title}</a> · <a href="/30da/terms?lang=${lang}">${t.terms_title}</a></p>
${backToApp(t)}`;
  return page({
    title: `${t.support_title} · 30+DA`,
    lang,
    inner: docColumn({ lang, flags: flagRow(lang, (c) => `/30da/support?lang=${c}`), body }),
  });
}

// ---------- the home page: GET /30da/home ----------

/**
 * The home page's photos (owner 2026-10-14): stills from the 30+DA teaser — AI-made, nobody real — in
 * src/thirtyda-app/home/img/ (its README names them), served at /30da/home/img/<slot>.<ext> (src/lib/thirtyda-home.mjs):
 *   hero        16:9 (768 × 432): the rooftop over the lit city at dusk — the share picture (Open Graph, JSON-LD)
 *   people-1    tall (768 × 1376): a woman on a rooftop terrace at dusk — fills the phone-shaped card
 *   people-2…4  tall, ONE sequence in this order, the red thread through each: the evening street, one woman sharp in a
 *               blurred crowd, a man and a woman walking past each other — the strip under the two columns
 * A slot with no file shows a night-city placeholder in the app's colours (navy, soft bokeh lights): never a made-up face.
 */
export const HOME_HERO = "hero";
export const HOME_PORTRAIT = "people-1";
export const HOME_SEQUENCE = Object.freeze(["people-2", "people-3", "people-4"]);
export const HOME_PEOPLE = Object.freeze([HOME_PORTRAIT, ...HOME_SEQUENCE]);
export const HOME_SLOTS = Object.freeze([HOME_HERO, ...HOME_PEOPLE]);
export const HOME_IMG_PATH = "/30da/home/img/";
/** The photo kinds a slot may have, in the order a <picture> offers them (webp first, jpg the fallback). */
export const HOME_IMG_EXTS = Object.freeze(["webp", "jpg"]);
const HOME_SIZE = { [HOME_HERO]: [768, 432], tall: [768, 1376] };

/** Where the page lives, and the picture a shared link shows (absolute: Telegram, Facebook and search engines fetch it). */
export const HOME_URL = "https://ecom.ggmt.sg/30da/home";
export const HOME_SHARE_IMG = `https://ecom.ggmt.sg${HOME_IMG_PATH}${HOME_HERO}.jpg`;
/** Support & Contact, as on the owner's template (the same three ways in to GK SMART's support). */
export const SUPPORT_TELEGRAM = "https://t.me/GKSmartbiz";
export const SUPPORT_WHATSAPP = "https://wa.me/6585565977";
const SUPPORT_WHATSAPP_SHOWN = "+65 8556 5977";
export const HOME_TAGS = Object.freeze(["#30DA", "#DatingFor30Plus", "#SafeDating", "#CalmDating", "#PhnomPenh", "#Cambodia",
  "#MeetSomeone", "#SecondChance", "#ការណាត់ជួប"]);
const HOME_KEYWORDS = "30+DA, dating for 30+, dating over 30, safe dating, calm dating, Phnom Penh dating, Cambodia dating app, "
  + "meet someone, second chance, ការណាត់ជួប, 金边交友, 프놈펜 데이트, プノンペン 出会い";
const OG_LOCALE = { en: "en_US", km: "km_KH", zh: "zh_CN", ko: "ko_KR", ja: "ja_JP" };

/**
 * zh / ja strings mark with "|" where a line may break (between phrases): <wbr> on the page (homeText), nothing anywhere
 * else (plain). On the page "30+" also stays on the line of the word before it (a no-break space), so it never hangs alone.
 */
const plain = (s) => String(s).replaceAll("|", "");
export const homeText = (s) => esc(s).replace(/ (?=30\+)/g, "\u00a0").replaceAll("|", "<wbr>");
const say = homeText;

const svg = (viewBox, inner) => `<svg viewBox="${viewBox}" aria-hidden="true" focusable="false">${inner}</svg>`;
/** The Google Play mark's own four colours (a brand mark: the one place on the page with colours outside the app's). */
export const PLAY_COLOURS = Object.freeze(["#00b0ff", "#ffc400", "#ff3a44", "#00d26a"]);
/** The store row's marks: the Apple logo and the 4-pane Windows logo in white (currentColor), Google Play in its colours. */
const STORE_MARK = {
  apple: svg("0 0 24 24", '<path fill="currentColor" d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.257-4.63-2.257-7.28 0-4.28 2.79-6.55 5.532-6.55 1.406 0 2.576.9 3.457.9.84 0 2.147-.95 3.734-.95.633 0 2.91.06 4.404 2.21-.114.07-2.628 1.53-2.628 4.63 0 3.7 3.24 5.01 3.434 5.02z"/>'),
  play: svg("0 0 512 512", `<path fill="${PLAY_COLOURS[0]}" d="M104 40c-8 7-13 18-13 32v336c0 14 5 25 13 32l4 3 189-189v-4l-15-15z"/>`
    + `<path fill="${PLAY_COLOURS[1]}" d="M356 271l-63-63v-4l63-63 4 2 75 43c21 12 21 32 0 44l-75 43z"/>`
    + `<path fill="${PLAY_COLOURS[2]}" d="M360 269l-64-64-193 193c7 8 19 9 32 2z"/>`
    + `<path fill="${PLAY_COLOURS[3]}" d="M296 209l64-64-225-129c-13-7-25-6-32 2z"/>`),
  windows: svg("0 0 24 24", '<path fill="currentColor" d="M2 2h9.4v9.4H2zm10.6 0H22v9.4h-9.4zM2 12.6h9.4V22H2zm10.6 0H22V22h-9.4z"/>'),
};
/** The sign-in pills' marks, white (currentColor): the ways 30+DA really signs people in on the web. */
const PILL_MARK = {
  tiktok: svg("0 0 24 24", '<path fill="currentColor" d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>'),
  telegram: svg("0 0 24 24", '<path fill="currentColor" d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>'),
  google: svg("0 0 24 24", '<path fill="currentColor" d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"/>'),
  facebook: svg("0 0 24 24", '<path fill="currentColor" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>'),
};
/** The sign-in pills, in this order (owner: "TikTok · Telegram · Google · Facebook · 👀 Guest"). */
export const HOME_SIGNINS = Object.freeze([["tiktok", "TikTok"], ["telegram", "Telegram"], ["google", "Google"], ["facebook", "Facebook"]]);
const ARROW = '<svg class="hm-i" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"'
  + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

/**
 * One photo slot: an <img> (a <picture> with the webp first when both kinds are there) when its file is on disk —
 * `exts` = the kinds there, from homePhotos() — else the night-city placeholder (decoration: hidden from screen readers).
 */
function homePhoto(slot, exts, alt, { eager = false } = {}) {
  const have = HOME_IMG_EXTS.filter((x) => Array.isArray(exts) && exts.includes(x));
  if (!have.length) return `<span class="hm-ph hm-ph-${slot}" aria-hidden="true"></span>`;
  const [width, height] = HOME_SIZE[slot] || HOME_SIZE.tall;
  const src = (x) => `${HOME_IMG_PATH}${slot}.${x}`;
  const img = `<img src="${src(have.at(-1))}" alt="${esc(alt)}" width="${width}" height="${height}" `
    + `${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
  return have.length > 1 ? `<picture><source type="image/webp" srcset="${src("webp")}">${img}</picture>` : img;
}

/**
 * The template's store icons, plus Windows (owner 2026-10-14: "and windows"): App Store and Google Play are not open yet
 * — no link, "— coming soon" — and Windows is 30+DA on a PC, the web app (/30da/). Shown twice: in the top bar next to
 * the flags, and on the card's top right.
 */
function storeRow(t, where) {
  const soon = (key, name) => {
    const label = esc(`${name} — ${plain(t.home_soon)}`);
    return `<span class="hm-store hm-store-${key}" role="img" aria-label="${label}" title="${label}">${STORE_MARK[key]}</span>`;
  };
  const win = esc(plain(t.home_win));
  return `<div class="hm-stores hm-stores-${where}">${soon("apple", "App Store")}${soon("play", "Google Play")}`
    + `<a class="hm-store hm-store-windows" href="${WEB_APP_PATH}" aria-label="${win}" title="${win}">${STORE_MARK.windows}</a></div>`;
}

/** The <head> extras of the home page: keywords, the address, the share card, and the app as JSON-LD (data, not a script). */
function homeHead(t, lang, title) {
  const desc = esc(plain(t.home_desc));
  const ld = {
    "@context": "https://schema.org",
    "@type": "MobileApplication",
    name: "30+DA",
    alternateName: "30+DA App",
    description: plain(t.home_desc),
    url: HOME_URL,
    image: HOME_SHARE_IMG,
    applicationCategory: "LifestyleApplication",
    applicationSubCategory: "Dating",
    operatingSystem: "iOS, Android",
    inLanguage: [...LANGS],
    audience: { "@type": "PeopleAudience", suggestedMinAge: 30 },
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher: { "@type": "Organization", name: OPERATOR, email: CONTACT_EMAIL },
  };
  // "<" never appears raw inside the JSON, so nothing in it can close the element.
  const json = JSON.stringify(ld).replace(/</g, "\\u003c");
  return `
  <meta name="keywords" content="${esc(HOME_KEYWORDS)}">
  <link rel="canonical" href="${HOME_URL}">
  <meta property="og:url" content="${HOME_URL}">
  <meta property="og:locale" content="${OG_LOCALE[lang]}">
  <meta property="og:image" content="${HOME_SHARE_IMG}">
  <meta property="og:image:width" content="${HOME_SIZE[HOME_HERO][0]}">
  <meta property="og:image:height" content="${HOME_SIZE[HOME_HERO][1]}">
  <meta property="og:image:alt" content="${esc(plain(t.home_alt))}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${desc}">
  <meta name="twitter:image" content="${HOME_SHARE_IMG}">
  <script type="application/ld+json">${json}</script>`;
}

/**
 * GET /30da/home[?lang=] — the front door, laid out like the owner's template (ggmt.sg/newsfeed/3una5aha, 2026-10-14:
 * "I give you the example of what MUST be on the home page"), in the app's own colours (navy, white, the soft greys; the
 * app's red only as the thin red string). Top bar: the wordmark, the flags, the store icons. PC: a phone-shaped card
 * left (people-1, the store icons top right, "30+DA App" + a line + two lines + the sign-in pills at the bottom) and the
 * words right; phones: the card first. The words: an eyebrow, the app's headline as the h1 with 💞, the same in Khmer
 * (on the other 4 languages), the lead, Open 30+DA (/30da/), the ⚠️ Reminder (free; never money, bank or card details;
 * never send money), how it works in words, Support & Contact (email, Telegram, WhatsApp), the hashtags. Then the
 * teaser's strip (people-2 → 3 → 4 on one taut red thread) and the footer. True to the code:
 *   Say hello  a few questions, answered with one tap (shared/questions.js LEVEL_RULES[1], replyOptions)
 *   Go deeper  a few more, a couple you write yourself (LEVEL_RULES[2]: 3 picked + 2 written); photo 2 opens
 *              (shared/rules.js PHOTO_SLOT_LEVELS)
 *   Chat       every line translated (src/lib/thirtyda-translate.mjs), real names; verify only to chat
 * No numbers for show (owner: "no numbers — it's 30+ year olds' dating life"): only the brand (30+DA, 30+), the hashtags
 * and the WhatsApp number carry digits. No script but the JSON-LD data block; no inline style (the page CSP).
 * `photos` = homePhotos(); none → every slot is its placeholder.
 */
export function homePage({ lang: want, photos = {} } = {}) {
  const lang = ok(want);
  const t = PAGE_STRINGS[lang];
  const km = PAGE_STRINGS.km;
  const q = `?lang=${lang}`;
  const cjk = lang === "zh" || lang === "ja";
  const photo = (slot, alt, opts) => homePhoto(slot, photos?.[slot], alt, opts);
  const title = `30+DA · ${plain(t.home_tagline)}`;
  const pills = HOME_SIGNINS.map(([key, name]) => `<a class="hm-pill" href="${WEB_APP_PATH}">${PILL_MARK[key]}<span>${name}</span></a>`).join("")
    + `<a class="hm-pill hm-pill-guest" href="${WEB_APP_PATH}"><span aria-hidden="true">👀</span><span>${say(t.home_guest)}</span></a>`;
  const step = (n) => `          <li><b>${say(t[`home_l${n}_h`])}</b> ${say(t[`home_l${n}`])}</li>`;
  const frame = (slot, i) => `      <li class="hm-fr">
        <figure>
          <div class="hm-fr-box"><div class="hm-fr-ph">${photo(slot, "")}</div></div>
          <figcaption>${say(t[`home_frame_${i + 2}`])}</figcaption>
        </figure>
      </li>`;
  // The local language under the headline, as the template has Sinhala: Khmer, on the other 4 languages' pages.
  const khmerSub = lang === "km" ? "" : `
      <p class="hm-km" lang="km">${say(km.home_headline)}<span>${say(km.home_tagline)}</span></p>`;
  const khmerRemind = lang === "km" ? "" : `
        <p class="hm-remind-km" lang="km">${say(km.home_remind)}</p>`;
  const tags = HOME_TAGS.map((tag) => (/[ក-៿]/.test(tag) ? `<span lang="km">${tag}</span>` : tag)).join(" ");
  const inner = `<header class="hm-top">
  <div class="hm-wrap hm-top-in">
    <a class="hm-logo" href="${WEB_APP_PATH}">30+DA</a>
    ${flagRow(lang, (c) => `/30da/home?lang=${c}`)}
    ${storeRow(t, "top")}
  </div>
</header>
<main class="hm-wrap hm-main">
  <svg class="hm-thread" aria-hidden="true" focusable="false" viewBox="0 0 1200 800" preserveAspectRatio="none"><path d="M-40 205 C 60 190, 110 250, 300 300 S 520 332, 700 335 S 1080 300, 1130 420 S 1200 520, 1240 500"/></svg>
  <div class="hm-cols">
    <div class="hm-left">
      <div class="hm-card">
        ${photo(HOME_PORTRAIT, plain(t.home_alt), { eager: true })}
        ${storeRow(t, "card")}
        <div class="hm-card-over">
          <p class="hm-card-h">30+DA App</p>
          <p class="hm-card-sub">${say(t.home_tagline)}</p>
          <p class="hm-card-desc">${say(t.home_card)}</p>
          <nav class="hm-pills" aria-label="${esc(plain(t.home_signin))}">${pills}</nav>
        </div>
      </div>
    </div>
    <div class="hm-text">
      <p class="hm-eyebrow">30+DA · ${say(t.home_place)}</p>
      <h1 class="hm-h1"><span class="hm-emoji" aria-hidden="true">💞</span> ${say(t.home_headline)}</h1>${khmerSub}
      <p class="hm-lead">${say(t.home_line)}${cjk ? "<wbr>" : " "}${say(t.home_lead)}</p>
      <p class="hm-cta"><a class="hm-btn" href="${WEB_APP_PATH}">${t.app_open}${ARROW}</a></p>
      <div class="hm-remind" role="note">
        <p class="hm-remind-h"><span aria-hidden="true">⚠️</span> ${say(t.home_remind_h)}</p>
        <p class="hm-remind-text">${say(t.home_remind)}</p>${khmerRemind}
      </div>
      <div class="hm-how">
        <h2 class="hm-how-h">${say(t.home_how_h)}</h2>
        <ol class="hm-path">
${[1, 2, 3].map(step).join("\n")}
        </ol>
        <p class="hm-how-fine">${say(t.home_verify)}</p>
      </div>
      <div class="hm-contact">
        <h2 class="hm-contact-h">${say(t.home_contact_h)}</h2>
        <a href="mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("30+DA support")}"><span aria-hidden="true">✉️</span> ${CONTACT_EMAIL}</a>
        <a href="${SUPPORT_TELEGRAM}" target="_blank" rel="noopener"><span aria-hidden="true">✈️</span> Telegram · @GKSmartbiz</a>
        <a href="${SUPPORT_WHATSAPP}" target="_blank" rel="noopener"><span aria-hidden="true">💬</span> WhatsApp · ${SUPPORT_WHATSAPP_SHOWN}</a>
      </div>
      <p class="hm-tags">${tags}</p>
    </div>
  </div>
</main>
<section class="hm-story" aria-labelledby="hm-string">
  <div class="hm-wrap">
    <h2 class="hm-string" id="hm-string">${say(t.home_string)}</h2>
    <ol class="hm-seq">
${HOME_SEQUENCE.map(frame).join("\n")}
    </ol>
  </div>
</section>
<footer class="hm-foot">
  <div class="hm-wrap">
    <p class="hm-foot-brand">30+DA · GK Newsroom · ggmt.sg</p>
    <p class="hm-foot-run">${t.run_by} <b>${OPERATOR}</b></p>
    <nav class="hm-foot-links" aria-label="30+DA">
      <a href="/30da/privacy${q}">${t.priv_title}</a>
      <a href="/30da/terms${q}">${t.home_terms}</a>
      <a href="/30da/support${q}">${t.home_help}</a>
      <a href="/30da/delete-data${q}">${t.del_title}</a>
    </nav>
  </div>
</footer>`;
  return page({ title, lang, inner, kind: "home", description: plain(t.home_desc), head: homeHead(t, lang, title) });
}

// ---------- the admin's "Try sign-in" result ----------

/** The one line that says what to fix. reason: see SIGNIN_REASONS + no_keys / admin_gone / too_many. */
function fixLine(t, provider, reason) {
  return t[`fix_${reason}_${provider}`] ?? t[`fix_${reason}`] ?? t.fix_other;
}

/**
 * The page a "Try sign-in" ends on. Nothing was saved: no profile, no session.
 * ok → big "Works ✓", "Google: <name> (<email>)" and one line: others get in once the app is published / Live
 * (the try proves the keys work for the owner; who else may sign in is up to Google / Meta, which it cannot see).
 * Else big "Did not work ✗" and one line what to fix. What Google / Facebook said in their own words is not shown
 * here: the Code page card keeps it (detail is accepted and ignored).
 * All 5 languages are in the page (it cannot be opened twice); `lang` picks the one shown first.
 */
export function tryResultPage({ provider, ok: worked, person = null, reason = null, lang: want = "en" }) {
  const first = ok(want);
  const name = esc(NAMES[provider] ?? "Sign-in");
  const [id, secret] = KEY_LABELS[provider] ?? ["ID", "secret"];
  const column = (code) => {
    const t = PAGE_STRINGS[code];
    const lines = worked
      ? `      <h1 class="try-big ok">${t.try_works} <span class="try-mark" aria-hidden="true">✓</span></h1>
      <p class="try-who">${name}: ${person?.name ? esc(person.name) : t.try_no_name} (${person?.email ? esc(person.email) : t.try_no_email})</p>
      <p class="try-line">${t[`try_others_${provider}`] ?? ""}</p>`
      : `      <h1 class="try-big bad">${t.try_failed} <span class="try-mark" aria-hidden="true">✗</span></h1>
      <p class="try-line">${fill(fixLine(t, provider, reason), { name, id, secret })}</p>`;
    const body = `${lines}
      <p class="doc-actions"><a class="doc-btn" href="/30da/admin/connections">${t.try_back}</a></p>`;
    return docColumn({ lang: code, flags: flagRow(code, (c) => `#${c}`), body, tag: "section" });
  };
  // The first-shown language goes last: a chosen #link (:target) earlier in the page hides it (pages.css).
  const order = [...LANGS.filter((c) => c !== first), first];
  const inner = order.map((code) => `<div class="tr${code === first ? " on" : ""}" id="${code}" lang="${code}">\n${column(code)}\n</div>`).join("\n");
  const t = PAGE_STRINGS[first];
  return page({
    title: `${fill(worked ? t.try_title_ok : t.try_title_bad, { name })} · 30+DA`,
    lang: first,
    inner,
    robots: "noindex",
    kind: "try",
  });
}

// ---------- the native apps: the end of a sign-in in the Android app's sheet ----------

/**
 * The page the Android app's sign-in sheet (a Chrome Custom Tab) ends on: one big "Open 30+DA" button — Chrome's
 * intent:// link to the app's package — and the plain sg.ggmt.thirtyda:// link under it; /30da/app-return.js tries
 * the button once by itself (no inline script: the page's CSP allows none). The two links carry the one-time ticket
 * (or the reason): src/lib/thirtyda-signin.mjs builds them, never from the request; they are only escaped here.
 * All 5 languages are in the page (the flags switch, like the try page); `lang` picks the one shown first.
 */
export function appReturnPage({ ok: done, provider = null, intentUrl, schemeUrl, lang: want = "en" }) {
  const first = ok(want);
  const name = esc(NAMES[provider] ?? "30+DA");
  const column = (code) => {
    const t = PAGE_STRINGS[code];
    const body = `      <h1>${t.app_title}</h1>
      <p class="doc-lede">${done ? fill(t.app_ok, { name }) : t.app_bad}</p>
      <p class="doc-actions"><a class="doc-btn" data-app-open href="${esc(intentUrl)}">${t.app_open}</a></p>
      <p class="doc-fine"><a href="${esc(schemeUrl)}">${t.app_link}</a></p>`;
    return docColumn({ lang: code, flags: flagRow(code, (c) => `#${c}`), body, tag: "section" });
  };
  // The first-shown language goes last: a chosen #link (:target) earlier in the page hides it (pages.css).
  const order = [...LANGS.filter((c) => c !== first), first];
  const inner = order.map((code) => `<div class="tr${code === first ? " on" : ""}" id="${code}" lang="${code}">\n${column(code)}\n</div>`).join("\n");
  return page({ title: PAGE_STRINGS[first].app_title, lang: first, inner, robots: "noindex", kind: "try", script: "/30da/app-return.js" });
}

// ---------- GKVerify's back button: GET /30da/back ----------

/** The web app, for a computer and for people without the app. */
export const WEB_APP_PATH = "/30da/";

/**
 * Which way back, from the browser's User-Agent: iPhone / iPad / iPod → 'ios', Android → 'android', anything else
 * (a computer, Telegram Desktop's browser, no header) → 'web'. An iPad that asks for the desktop site says "Macintosh"
 * and gets the web app (its "Open 30+DA in the browser" is the same place).
 */
export function backPlatform(userAgent) {
  const ua = String(userAgent ?? "").slice(0, 512);
  if (/\b(?:iPhone|iPad|iPod)\b/.test(ua)) return "ios";
  if (/\bAndroid\b/i.test(ua)) return "android";
  return "web";
}

/**
 * The big button's link for a platform: the app's own scheme on iOS (sg.ggmt.thirtyda://open); on Android Chrome's
 * intent:// link to the app's package, which falls back to <origin>/30da/ when the app is not there; else /30da/.
 * The scheme and package are fixed (src/lib/thirtyda-signin.mjs APP_SCHEME): never taken from the request. `origin`
 * is the site's own (publicOrigin), encoded whole as the fallback address.
 */
export function backHref(platform, origin) {
  if (platform === "ios") return `${APP_SCHEME}://open`;
  if (platform === "android") {
    const fallback = encodeURIComponent(`${origin}${WEB_APP_PATH}`);
    return `intent://open#Intent;scheme=${APP_SCHEME};package=${APP_PACKAGE};S.browser_fallback_url=${fallback};end`;
  }
  return WEB_APP_PATH;
}

/**
 * The page GKVerify's "⬅️ Back to 30+DA" Telegram button opens (src/lib/thirtyda-telegram-bot.mjs backReply):
 * one big "Open 30+DA" button (href: backHref) and, under it, a small "Open 30+DA in the browser" link to /30da/ for
 * people without the app. /30da/back.js tries the button once by itself (no inline script: the page's CSP allows
 * none). All 5 languages are in the page, the flags switch with #links (no reload, so the auto-try does not run
 * again); `lang` (?lang= / Accept-Language) picks the one shown first.
 */
export function backPage({ href = WEB_APP_PATH, lang: want = "en" } = {}) {
  const first = ok(want);
  const column = (code) => {
    const t = PAGE_STRINGS[code];
    const body = `      <h1>${t.app_title}</h1>
      <p class="doc-lede">${t.back_lede}</p>
      <p class="doc-actions"><a class="doc-btn doc-btn-big" data-back-open href="${esc(href)}">${t.app_open}</a></p>
      <p class="doc-web"><a href="${WEB_APP_PATH}">${t.back_web}</a></p>`;
    return docColumn({ lang: code, flags: flagRow(code, (c) => `#${c}`), body, tag: "section" });
  };
  // The first-shown language goes last: a chosen #link (:target) earlier in the page hides it (pages.css).
  const order = [...LANGS.filter((c) => c !== first), first];
  const inner = order.map((code) => `<div class="tr${code === first ? " on" : ""}" id="${code}" lang="${code}">\n${column(code)}\n</div>`).join("\n");
  return page({ title: PAGE_STRINGS[first].app_title, lang: first, inner, robots: "noindex", kind: "back", script: "/30da/back.js" });
}
