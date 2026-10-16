/**
 * 30+DA · meetings in the Level 3 chat (owner 2026-10-14: "a small calendar icon to set an appointment … the other party
 * accepts; the other party can see the location; clicking the location opens Google Maps"). The rules: shared/meet.js.
 *
 *   GET  /places?q=…[&near=lat,lng]  → { places: [{ name, address, lat, lng, ref, source?, km? }], cached?, busy?, unavailable? }
 *        ?brand=<id> instead of q: a chip of the sheet (shared/meet.js MEET_BRANDS) — that brand only, nearest first, km each
 *        the place search (src/lib/thirtyda-places.mjs: our own Phnom Penh list first, src/lib/thirtyda-places-index.mjs,
 *        then OpenStreetMap Nominatim), asked only on Enter or the Search
 *        button (never as you type: the Nominatim usage policy). Only for someone with a Level 3 chat (users.level 3);
 *        near = the asker's stored point when not given; 10 searches a minute each. `ref`: the server's signature of
 *        that suggestion for that person (1 hour).
 *   POST /pairs/:id/meet { place: { name, address?, lat?, lng?, ref? }, at: ISO }  → 201 { message, replaced: [message] }
 *        suggests a meeting: a chat message { kind: 'meet', meet: { at, place, status: 'proposed', by, … } }. The place
 *        goes through the chat's own checks, stopped and kept for the admin like a chat line (422 contact_detail |
 *        bad_word { index: 0 name / 1 address }): the name and the address each, the two read together ("Cafe 012 887"
 *        + "766 Street"), and the place line read with my last chat lines and meetings (a number split between a chat
 *        line and a place; the chat reads a later line with this meeting the same way). The address and the map point
 *        are kept only for a place the server suggested (a good `ref`, or a place already in this conversation, as
 *        "Suggest another time" sends it): a typed place is its name alone, and a point outside Cambodia is dropped.
 *        One open suggestion per conversation: an older one still open becomes cancelled with note 'replaced'. 6 an
 *        hour per conversation (stopped tries count), 20 a day in all → 429 rate_limited.
 *   POST /pairs/:id/meet/:mid { action: 'accept' | 'decline' | 'cancel' }  → { message }
 *        only the other person accepts / declines (while proposed), only the proposer cancels (proposed or accepted),
 *        never after its time → 403 not_yours | 409 not_open | 409 past, each with the meeting as it is now.
 *
 * Level 3 only and like the chat in every other way: pairFor (my conversation; review accounts and real people never
 * meet — sameWorld; a frozen one — blocked either way, or the other person left — refuses writes) and chatGate (the
 * chat is open; a verified way). A suggestion or an answer is news for the other person exactly like a chat line
 * (pairs.lastChat: their red dot, the heartbeat's actions). GET /pairs/:id/messages carries the meetings with the chat
 * lines and again whenever one changed (its updatedAt passes the poll's `after`). The other person can report a
 * meeting card like a chat line (POST /pairs/:id/messages/:mid/report).
 */
import {
  MEET_ACTIONS, MEET_MAX_DAYS, MEET_PER_PAIR_HOUR, MEET_PER_DAY, PLACE_SEARCHES_PER_MINUTE,
  checkPlace, checkMeetTime, placeTexts, placeLine, meetActionCheck, meetsLastHour, meetView, samePlace, keptPlace, brandById,
} from "../thirtyda-app/shared/meet.js";
import { createPlaceSearch, createPlaceRefs, parseNear, cleanQuery } from "./thirtyda-places.mjs";
import { createPlaceIndex } from "./thirtyda-places-index.mjs";
import { createGooglePlaces } from "./thirtyda-places-google.mjs";
import { windowLimiter } from "./thirtyda-telegram-bot.mjs";
import { outboundFetch } from "./thirtyda-test-fetch.mjs";

export const MEET_TEXT = Object.freeze({
  place: "Pick a place.",
  bad_time: "Pick a date and a time.",
  past: "Pick a time that is still to come.",
  too_far: `Pick a day within ${MEET_MAX_DAYS} days.`,
  action: "Choose accept, decline or cancel.",
  not_found: "No such meeting.",
  not_yours: "This is not yours to answer.",
  not_open: "This meeting was already answered.",
  passed: "This meeting's time has passed.",
  rate_limited: "Too many meeting suggestions. Try again later.",
  searches: "Too many searches. Wait a minute.",
  level3: "Meetings are for a Level 3 chat.",
});

/**
 * The server's one place list, its Google client and one place search (its cache, its Nominatim queue): GET /places and the Code page's
 * Tower 12 (src/lib/thirtyda-hub-places.mjs: status, Refresh now, a test search) share them.
 */
let sharedIndex = null;
let sharedSearch = null;
let sharedGoogle = null;
export const placeIndex = () => (sharedIndex ??= createPlaceIndex({ fetchImpl: outboundFetch() }));
// Google Places (src/lib/thirtyda-places-google.mjs): asked first once its key is saved on Tower 12 and turned on.
export const placesGoogle = () => (sharedGoogle ??= createGooglePlaces({ fetchImpl: outboundFetch() }));
export const placeSearch = () => (sharedSearch ??= createPlaceSearch({ fetchImpl: outboundFetch(), index: placeIndex(), google: placesGoogle() }));

/** When a meeting message last changed: a later accept / decline / cancel / replace shows up in the next poll. */
export const changedAt = (m) => Math.max(Date.parse(m?.at) || 0, Date.parse(m?.meet?.updatedAt) || 0);

/** The person's stored point { lat, lng } (GeoJSON [lng, lat]), or null. */
function pointOf(me) {
  const c = me?.location?.coordinates;
  return Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]) ? { lat: c[1], lng: c[0] } : null;
}

/**
 * The three handlers, given the app's own pieces (src/lib/thirtyda-app.mjs): C (collection names), fail, nowIso,
 * nextId, appendMessages, pairFor, chatGate, stopContactDetails, stopSplitContactDetails, stopSplitChat, stopBadWords.
 * placeSearch / placeRefs / now / limits: for tests.
 */
export function meetRoutes({
  C, fail, nowIso, nextId, appendMessages, pairFor, chatGate, stopContactDetails, stopSplitContactDetails, stopSplitChat,
  stopBadWords, placeSearch = null, placeRefs = null, now = () => Date.now(), limits = {},
}) {
  const daily = limits.daily ?? windowLimiter(864e5);
  const searches = limits.searches ?? windowLimiter(60e3);
  let search = placeSearch;
  // Our own Phnom Penh place list first (kept in Mongo or a local file, refreshed weekly from Overpass), then Nominatim.
  const searcher = () => (search ??= placeSearch());
  let refs = placeRefs;
  const signer = () => (refs ??= createPlaceRefs());

  /** GET /places?q=…[&near=lat,lng] */
  async function places(ctx) {
    const { me, url } = ctx;
    if ((Number(me?.level) || 1) < 3) throw fail(403, "chat_closed", MEET_TEXT.level3);
    // A brand chip (?brand=<id>, shared/meet.js MEET_BRANDS): the server's own words for it, nearest first with `km`.
    const brand = url.searchParams.has("brand") ? brandById(url.searchParams.get("brand")) : null;
    const q = brand ? brand.q : cleanQuery(url.searchParams.get("q"));
    if (!q) return { places: [] };
    if (searches.over(me._id, PLACE_SEARCHES_PER_MINUTE)) throw fail(429, "rate_limited", MEET_TEXT.searches);
    const near = parseNear(url.searchParams.get("near")) ?? pointOf(me);
    const r = await searcher().search({ q, lang: me.lang ?? "en", near, ...(brand ? { brand } : {}) });
    // Each suggestion signed for this person: what POST /pairs/:id/meet keeps the address and the map point by.
    return { ...r, places: (r?.places || []).map((p) => ({ ...p, ref: signer().sign(p, me._id) })) };
  }

  /** POST /pairs/:id/meet { place, at } */
  async function propose(ctx) {
    const { d, me, body, params } = ctx;
    const { pair, other } = await pairFor(ctx, params[0], { write: true });
    chatGate(ctx, pair);
    const p = checkPlace(body.place);
    if (!p.ok) throw fail(422, "invalid", MEET_TEXT.place, { field: "place", part: p.field });
    const t = now();
    const when = checkMeetTime(body.at, t);
    if (!when.ok) throw fail(422, when.error, MEET_TEXT[when.error], { field: "at" });

    const chats = d.collection(C.chats);
    const chat = await chats.findOne({ _id: pair._id }, { projection: { messages: 1 } });
    if (meetsLastHour(chat?.messages, me._id, t) >= MEET_PER_PAIR_HOUR || daily.over(me._id, MEET_PER_DAY, t)) {
      throw fail(429, "rate_limited", MEET_TEXT.rate_limited);
    }
    // The chat's own checks on what was sent, stopped and kept for the admin like a chat line (kind 'meet'): each text,
    // the name and the address read together, and the place line read with my last chat lines and meetings.
    const texts = placeTexts(p.place);
    await stopContactDetails(ctx, pair, other, texts, { level: 3, kind: "meet" });
    await stopSplitContactDetails(ctx, pair, other, texts, { level: 3, kind: "meet" });
    await stopSplitChat(ctx, pair, other, placeLine(p.place), { kind: "meet" });
    await stopBadWords(ctx, pair, other, texts, { level: 3, kind: "meet" });

    // The address and the map point only for a place the server suggested (its signed ref, or a place already in this
    // conversation): else the name alone, which Google Maps searches.
    const log = chat?.messages || [];
    const sentRef = body.place && typeof body.place === "object" ? body.place.ref : null;
    const known = signer().ok(p.place, sentRef, me._id)
      || log.some((m) => m.kind === "meet" && !m.stopped && samePlace(m.meet?.place, p.place));
    const place = keptPlace(p.place, known);

    const open = log.filter((m) => m.kind === "meet" && !m.stopped && m.meet?.status === "proposed");
    const id = await nextId(d, "msg");
    const at = nowIso();
    const lang = me.lang ?? "en";
    const text = placeLine(place);
    const msg = {
      id, from: me._id, at, kind: "meet", level: 3, text, lang, english: null, translations: { [lang]: text },
      hit: null, flagId: null, stopped: false,
      meet: {
        at: when.at, place, status: "proposed", by: me._id, updatedAt: at, note: null, doneBy: null,
        replaces: open.length ? open[open.length - 1].id : null,
      },
    };
    await appendMessages(d, pair, [msg]);
    // One open suggestion per conversation: every older one still open (theirs too) is cancelled as 'replaced'. Only
    // older ones, so of two sent at the same moment the later one stays open.
    const replaced = { status: "cancelled", note: "replaced", updatedAt: at, doneBy: me._id };
    await chats.updateOne(
      { _id: pair._id },
      { $set: Object.fromEntries(Object.entries(replaced).map(([k, v]) => [`messages.$[m].meet.${k}`, v])) },
      { arrayFilters: [{ "m.kind": "meet", "m.meet.status": "proposed", "m.id": { $ne: id }, "m.at": { $lte: at } }] },
    );
    await d.collection(C.pairs).updateOne({ _id: pair._id }, { $set: { updatedAt: at, lastChat: { from: me._id, at } } });
    ctx.status = 201;
    return {
      message: meetView(msg, me._id),
      replaced: open.map((m) => meetView({ ...m, meet: { ...m.meet, ...replaced } }, me._id)),
    };
  }

  /** POST /pairs/:id/meet/:mid { action } */
  async function act(ctx) {
    const { d, me, body, params } = ctx;
    const action = String(body.action ?? "");
    if (!MEET_ACTIONS.includes(action)) throw fail(422, "invalid", MEET_TEXT.action, { field: "action" });
    const { pair } = await pairFor(ctx, params[0], { write: true });
    chatGate(ctx, pair);
    const chats = d.collection(C.chats);
    const read = async () => {
      const chat = await chats.findOne({ _id: pair._id }, { projection: { messages: { $elemMatch: { id: params[1] } } } });
      return (chat?.messages || []).find((x) => x.id === params[1]) ?? null;
    };
    const m = await read();
    if (!m || m.kind !== "meet" || m.stopped || !m.meet) throw fail(404, "not_found", MEET_TEXT.not_found);
    const v = meetActionCheck(m.meet, me._id, action, now());
    if (v.error) {
      throw fail(v.error === "not_yours" ? 403 : 409, v.error, MEET_TEXT[v.error === "past" ? "passed" : v.error], { message: meetView(m, me._id) });
    }
    if (v.same) return { message: meetView(m, me._id) };
    const at = nowIso();
    const patch = { status: v.status, updatedAt: at, doneBy: me._id };
    // Only from the status it had when read: of a cancel and an accept at the same moment, one wins.
    const done = await chats.updateOne(
      { _id: pair._id },
      { $set: Object.fromEntries(Object.entries(patch).map(([k, val]) => [`messages.$[m].meet.${k}`, val])) },
      { arrayFilters: [{ "m.id": m.id, "m.meet.status": m.meet.status }] },
    );
    if (!done.modifiedCount) {
      const now2 = await read();
      throw fail(409, "not_open", MEET_TEXT.not_open, { message: now2 ? meetView(now2, me._id) : null });
    }
    await d.collection(C.pairs).updateOne({ _id: pair._id }, { $set: { updatedAt: at, lastChat: { from: me._id, at } } });
    return { message: meetView({ ...m, meet: { ...m.meet, ...patch } }, me._id) };
  }

  return { places, propose, act };
}
